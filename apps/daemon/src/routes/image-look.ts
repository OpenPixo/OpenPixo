import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Express } from 'express';
import {
  CLOUD_TOOL_TEXT_MAX_CHARS, IMAGE_LOOK_MAX_FILE_BYTES, IMAGE_LOOK_QUESTION_MAX_CHARS, PRODUCT_CLI_NAME,
  type CloudToolCloudRequest, type CloudToolInfo, type CloudToolResponse, type ImageLookResponse,
} from '@openpixo/contracts';
import { record } from '../account/supabase.js';
import { getProject } from '../db.js';
import { gameVerifyArtifact, gameVerifyArtifactDir } from '../game/verify-store.js';
import { createToolRequestAuth } from '../http/tool-request-auth.js';
import type { OpenPixoAgentGateway } from '../openpixo-agent/gateway.js';
import { assertImageLookExtension, cloudToolThroughGateway, ImageLookError, imageLookDataUrl, lookThroughGateway, parseImageLookRequest } from '../openpixo-agent/look.js';
import { resolveProjectDir, resolveProjectFilePath } from '../projects.js';
import type { RouteDeps } from '../server-context.js';
import { CLOUD_TOOL_ENDPOINT, IMAGE_LOOK_TOOL_ENDPOINT, toolTokenRegistry } from '../tool-tokens.js';

export interface RegisterImageLookRoutesDeps extends RouteDeps<'db' | 'http' | 'authorizeProjectToolRequest'> {
  paths: { PROJECTS_DIR: string; ARTIFACTS_DIR: string };
  gateway: Pick<OpenPixoAgentGateway, 'hasRun' | 'sideRequest' | 'toolRequest'>;
  /** The cloud tools a hosted run may call; `look` among them means the cloud holds the look prompt. */
  cloudTools?: (() => Promise<readonly CloudToolInfo[]>) | undefined;
  /** A staged recipe candidate of this game at this path, re-resolved inside its run; null when it is none. */
  recipeCandidateFile?: ((projectId: string, file: string) => Promise<string | null>) | undefined;
}

export const IMAGE_LOOK_NOT_HOSTED_MESSAGE = `${PRODUCT_CLI_NAME} look is for the OpenPixo-credits agent; open the image directly.`;
export const CLOUD_TOOL_NOT_HOSTED_MESSAGE = `${PRODUCT_CLI_NAME} tool works only with OpenPixo's models.`;
/** The cloud's tool that answers `pixo look`. */
const LOOK_TOOL_ID = 'look';
const OUTSIDE_MESSAGE = 'Look only at images inside this project, or at a verification image path the host returned.';
const VERIFY_IMAGE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg)$/iu;

const isInside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * The file a look reads: a project file through the project's own symlink-aware boundary, a
 * verification image of this project, or a staged recipe candidate of this game. Anything else
 * is refused, traversal and links out included.
 */
async function resolveLookFile(ctx: RegisterImageLookRoutesDeps, projectId: string, metadata: unknown, requested: string): Promise<string> {
  assertImageLookExtension(requested);
  let name = requested;
  if (path.isAbsolute(requested)) {
    const absolute = path.resolve(requested);
    const verifyDir = gameVerifyArtifactDir(ctx.paths.ARTIFACTS_DIR, projectId);
    const verifyImage = VERIFY_IMAGE.exec(path.basename(absolute));
    if (verifyImage && path.relative(verifyDir, path.dirname(absolute)) === '') {
      try { return await gameVerifyArtifact(verifyDir, verifyImage[1]!, verifyImage[2]!.toLowerCase() as 'png' | 'jpg'); }
      catch { throw new ImageLookError(404, 'FILE_NOT_FOUND', 'That verification image is gone. Run the check again.'); }
    }
    const candidate = await ctx.recipeCandidateFile?.(projectId, absolute).catch(() => null);
    if (candidate) return candidate;
    const projectDir = resolveProjectDir(ctx.paths.PROJECTS_DIR, projectId, metadata);
    const roots = [projectDir, await realpath(projectDir).catch(() => projectDir)];
    const root = roots.find((dir) => isInside(dir, absolute));
    if (!root) throw new ImageLookError(403, 'FORBIDDEN', OUTSIDE_MESSAGE);
    name = path.relative(root, absolute);
  }
  let file: string;
  try {
    file = (await resolveProjectFilePath(ctx.paths.PROJECTS_DIR, projectId, name, metadata)).filePath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') throw new ImageLookError(404, 'FILE_NOT_FOUND', `No image at ${requested}.`);
    throw new ImageLookError(403, 'FORBIDDEN', OUTSIDE_MESSAGE);
  }
  return file;
}

/** `POST /api/tools/look`: the hosted agent's `pixo look`, on its run's tool token. No UI calls it. */
export function registerImageLookRoutes(app: Express, ctx: RegisterImageLookRoutesDeps): void {
  const { sendApiError } = ctx.http;
  const { authorizeToolRequest } = createToolRequestAuth(toolTokenRegistry);
  app.post(IMAGE_LOOK_TOOL_ENDPOINT, async (req, res) => {
    const grant = authorizeToolRequest(req, res, 'image:look', { endpoint: IMAGE_LOOK_TOOL_ENDPOINT });
    if (!grant) return;
    res.set('Cache-Control', 'no-store');
    if (!ctx.gateway.hasRun(grant.runId)) { sendApiError(res, 409, 'CONFLICT', IMAGE_LOOK_NOT_HOSTED_MESSAGE); return; }
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      const request = parseImageLookRequest(req.body);
      const project = getProject(ctx.db, grant.projectId);
      if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return; }
      if (!await ctx.authorizeProjectToolRequest(res, grant.projectId, { mode: 'read' })) return;
      const file = await resolveLookFile(ctx, grant.projectId, project.metadata, request.path);
      const info = await stat(file);
      if (!info.isFile()) throw new ImageLookError(404, 'FILE_NOT_FOUND', `No image at ${request.path}.`);
      if (info.size > IMAGE_LOOK_MAX_FILE_BYTES) {
        throw new ImageLookError(413, 'PAYLOAD_TOO_LARGE', `The image is larger than ${IMAGE_LOOK_MAX_FILE_BYTES / 1024 / 1024} MB.`);
      }
      const dataUrl = await imageLookDataUrl(await readFile(file));
      const tools = await ctx.cloudTools?.().catch(() => []) ?? [];
      // Once the cloud holds the look prompt it answers as a tool; an older cloud gets the app's own prompt.
      const answer: ImageLookResponse = tools.some((tool) => tool.id === LOOK_TOOL_ID && tool.input === 'image')
        ? { ...await cloudToolThroughGateway(ctx.gateway as OpenPixoAgentGateway, grant.runId, LOOK_TOOL_ID,
          { question: request.question, image: dataUrl }, abort.signal), model: LOOK_TOOL_ID }
        : await lookThroughGateway(ctx.gateway as OpenPixoAgentGateway, grant.runId, request.question, dataUrl, abort.signal);
      res.json(answer);
    } catch (error) {
      if (res.headersSent || abort.signal.aborted) return;
      if (error instanceof ImageLookError) { sendApiError(res, error.status, error.code, error.message); return; }
      sendApiError(res, 500, 'INTERNAL_ERROR', 'The image could not be looked at.');
    }
  });

  app.post(CLOUD_TOOL_ENDPOINT, async (req, res) => {
    const grant = authorizeToolRequest(req, res, 'cloud:tool', { endpoint: CLOUD_TOOL_ENDPOINT });
    if (!grant) return;
    res.set('Cache-Control', 'no-store');
    if (!ctx.gateway.hasRun(grant.runId)) { sendApiError(res, 409, 'CONFLICT', CLOUD_TOOL_NOT_HOSTED_MESSAGE); return; }
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      const body = record(req.body);
      const tools = await ctx.cloudTools?.().catch(() => []) ?? [];
      const tool = tools.find((item) => item.id === body.tool);
      if (!tool) {
        throw new ImageLookError(404, 'NOT_FOUND', tools.length
          ? `No cloud tool named ${String(body.tool).slice(0, 64)}. Tools: ${tools.map((item) => item.id).join(', ')}.`
          : 'No cloud tools are available right now.');
      }
      const question = typeof body.question === 'string' ? body.question.trim() : '';
      if (!question) throw new ImageLookError(400, 'BAD_REQUEST', 'Ask a question (--question): what should the tool check?');
      if (question.length > IMAGE_LOOK_QUESTION_MAX_CHARS) {
        throw new ImageLookError(400, 'BAD_REQUEST', `Keep the question under ${IMAGE_LOOK_QUESTION_MAX_CHARS} characters.`);
      }
      const cloudBody: CloudToolCloudRequest = { question };
      if (tool.input === 'image') {
        if (typeof body.path !== 'string' || !body.path.trim() || body.path.length > 4096 || body.path.includes('\0')) {
          throw new ImageLookError(400, 'BAD_REQUEST', `${tool.id} looks at an image: pass its path (--file).`);
        }
        const project = getProject(ctx.db, grant.projectId);
        if (!project) { sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found'); return; }
        if (!await ctx.authorizeProjectToolRequest(res, grant.projectId, { mode: 'read' })) return;
        const file = await resolveLookFile(ctx, grant.projectId, project.metadata, body.path);
        const info = await stat(file);
        if (!info.isFile()) throw new ImageLookError(404, 'FILE_NOT_FOUND', `No image at ${body.path}.`);
        if (info.size > IMAGE_LOOK_MAX_FILE_BYTES) {
          throw new ImageLookError(413, 'PAYLOAD_TOO_LARGE', `The image is larger than ${IMAGE_LOOK_MAX_FILE_BYTES / 1024 / 1024} MB.`);
        }
        cloudBody.image = await imageLookDataUrl(await readFile(file));
      } else {
        const text = typeof body.text === 'string' ? body.text : '';
        if (!text.trim()) throw new ImageLookError(400, 'BAD_REQUEST', `${tool.id} reads text: pass it with --text-file.`);
        if (text.length > CLOUD_TOOL_TEXT_MAX_CHARS) {
          throw new ImageLookError(413, 'PAYLOAD_TOO_LARGE', `Keep the text under ${CLOUD_TOOL_TEXT_MAX_CHARS} characters: pass only the part to check.`);
        }
        cloudBody.text = text;
      }
      const answer: CloudToolResponse = await cloudToolThroughGateway(ctx.gateway as OpenPixoAgentGateway, grant.runId, tool.id, cloudBody, abort.signal);
      res.json(answer);
    } catch (error) {
      if (res.headersSent || abort.signal.aborted) return;
      if (error instanceof ImageLookError) { sendApiError(res, error.status, error.code, error.message); return; }
      sendApiError(res, 500, 'INTERNAL_ERROR', 'The cloud tool could not be used.');
    }
  });
}
