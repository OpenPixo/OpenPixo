import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Express } from 'express';
import { IMAGE_LOOK_MAX_FILE_BYTES, PRODUCT_CLI_NAME, type ImageLookResponse } from '@openpixo/contracts';
import { getProject } from '../db.js';
import { gameVerifyArtifact, gameVerifyArtifactDir } from '../game/verify-store.js';
import { createToolRequestAuth } from '../http/tool-request-auth.js';
import type { OpenPixoAgentGateway } from '../openpixo-agent/gateway.js';
import { assertImageLookExtension, ImageLookError, imageLookDataUrl, lookThroughGateway, parseImageLookRequest } from '../openpixo-agent/look.js';
import { resolveProjectDir, resolveProjectFilePath } from '../projects.js';
import type { RouteDeps } from '../server-context.js';
import { IMAGE_LOOK_TOOL_ENDPOINT, toolTokenRegistry } from '../tool-tokens.js';

export interface RegisterImageLookRoutesDeps extends RouteDeps<'db' | 'http' | 'authorizeProjectToolRequest'> {
  paths: { PROJECTS_DIR: string; ARTIFACTS_DIR: string };
  gateway: Pick<OpenPixoAgentGateway, 'hasRun' | 'sideRequest'>;
  /** A staged recipe candidate of this game at this path, re-resolved inside its run; null when it is none. */
  recipeCandidateFile?: ((projectId: string, file: string) => Promise<string | null>) | undefined;
}

export const IMAGE_LOOK_NOT_HOSTED_MESSAGE = `${PRODUCT_CLI_NAME} look is for the OpenPixo-credits agent; open the image directly.`;
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
      const answer: ImageLookResponse = await lookThroughGateway(ctx.gateway as OpenPixoAgentGateway, grant.runId, request.question, dataUrl, abort.signal);
      res.json(answer);
    } catch (error) {
      if (res.headersSent || abort.signal.aborted) return;
      if (error instanceof ImageLookError) { sendApiError(res, error.status, error.code, error.message); return; }
      sendApiError(res, 500, 'INTERNAL_ERROR', 'The image could not be looked at.');
    }
  });
}
