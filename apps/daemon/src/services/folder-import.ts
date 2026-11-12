import { GAME_SAMPLE_TEMPLATE_ID, type ImportFolderRequest, type OrchestratorWorkspace, type ProjectMetadata } from '@openpixo/contracts';
import type { Request, Response } from 'express';
import type { RouteDeps } from '../server-context.js';
import { folderHoldsExistingWork, newGamePlan } from '../game/plan.js';

import { sandboxImportedProjectRootUnavailableReason } from '../sandbox-mode.js';
import { parseOrchestratorWorkspace } from '../workspace-contract.js';

interface FolderImportDeps extends RouteDeps<'db' | 'http' | 'node' | 'ids' | 'paths' | 'imports' | 'auth' | 'projectStore' | 'conversations' | 'projectFiles' | 'validation'> {

}

export interface FolderImportAuthorization {
  trustedPickerImport: boolean;
}

/** Shared trusted-folder import boundary for folder imports and game creation. */
export function createFolderImporter(
  ctx: FolderImportDeps,
  blockedProjectRootReason: (baseDir: string) => Promise<string | null>,
) {
  const { db } = ctx;
  const { sendApiError } = ctx.http;
  const { fs, path } = ctx.node;
  const { randomId } = ctx.ids;
  const { RUNTIME_DATA_DIR_CANONICAL } = ctx.paths;
  const { detectEntryFile } = ctx.imports;
  const { consumedImportNonces, desktopAuthSecret, isDesktopAuthGateActive,
    pruneExpiredImportNonces, verifyDesktopImportToken } = ctx.auth;
  const { insertProject } = ctx.projectStore;
  const { insertConversation } = ctx.conversations;
  const { setTabs } = ctx.projectFiles;
  const { validateProjectSkillId } = ctx.validation;

  type TokenCheck =
    | { ok: true; trustedPickerImport: false }
    | { ok: true; trustedPickerImport: true; nonce: string; exp: number }
    | { ok: false; pending: boolean; reason: string };

  // The one authorization rule. While the desktop gate is active a path is
  // accepted only with an unspent, unexpired picker token signed for exactly
  // that path; otherwise any path passes on to the root policy. Never records
  // the nonce: spending it is authorize()'s job alone.
  function checkImportToken(req: Request, baseDir: string): TokenCheck {
    if (!isDesktopAuthGateActive()) return { ok: true, trustedPickerImport: false };
    const secret = desktopAuthSecret();
    if (secret == null) {
      return { ok: false, pending: true, reason: 'desktop auth required but secret not yet registered' };
    }
    const headerValue = req.get('x-pixo-desktop-import-token');
    const token = typeof headerValue === 'string' ? headerValue : '';
    const now = Date.now();
    pruneExpiredImportNonces(now);
    const verification = verifyDesktopImportToken(
      secret,
      baseDir,
      token,
      now,
      consumedImportNonces,
    );
    if (!verification.ok) return { ok: false, pending: false, reason: verification.reason };
    return { ok: true, trustedPickerImport: true, nonce: verification.nonce, exp: verification.exp };
  }

  // The token is bound to the directory chosen in the native picker. Game
  // creation spends a parent-directory token before writing its child folder.
  async function authorize(req: Request, res: Response, baseDir: string): Promise<FolderImportAuthorization | null> {
    const check = checkImportToken(req, baseDir);
    if (!check.ok && check.pending) {
      sendApiError(
        res,
        503,
        'DESKTOP_AUTH_PENDING',
        check.reason,
        {
          details: { hint: 'restart desktop or wait for sidecar registration' },
          retryable: true,
        },
      );
      return null;
    }
    if (!check.ok) {
      sendApiError(
        res,
        403,
        'FORBIDDEN',
        'desktop import token rejected',
        { details: { reason: check.reason } },
      );
      return null;
    }
    if (check.trustedPickerImport) consumedImportNonces.set(check.nonce, check.exp);
    return { trustedPickerImport: check.trustedPickerImport };
  }

  /**
   * Would authorize() accept this request for baseDir right now? Same rule,
   * but the token stays unspent, so a preflight can run before the write that
   * spends it. Grants nothing on its own.
   */
  function inspectAuthorization(
    req: Request,
    baseDir: string,
  ): (FolderImportAuthorization & { ok: true }) | { ok: false; reason: string } {
    const check = checkImportToken(req, baseDir);
    return check.ok
      ? { ok: true, trustedPickerImport: check.trustedPickerImport }
      : { ok: false, reason: check.reason };
  }

  // Also used on a prospective child directory BEFORE any template is copied.
  async function rootRejectionReason(
    normalizedPath: string,
    trustedPickerImport: boolean,
    orchestratorWorkspace?: OrchestratorWorkspace | null,
  ): Promise<string | null> {
    if (path.parse(normalizedPath).root === normalizedPath) return 'cannot import the filesystem root';
    if (normalizedPath === RUNTIME_DATA_DIR_CANONICAL ||
        normalizedPath.startsWith(RUNTIME_DATA_DIR_CANONICAL + path.sep)) {
      return 'cannot import the data directory';
    }
    const blocked = await blockedProjectRootReason(normalizedPath);
    if (blocked) return blocked;
    return orchestratorWorkspace && trustedPickerImport
      ? null
      : sandboxImportedProjectRootUnavailableReason(normalizedPath);
  }

  async function importFolder(
    req: Request,
    res: Response,
    input: ImportFolderRequest = req.body,
    authorization?: FolderImportAuthorization,
    /** Creation-owned facts (game setup, art style) recorded with the project row. */
    extraMetadata?: Pick<ProjectMetadata, 'gameSetup' | 'artStyleId'>,
  ) {

    try {
      const { baseDir, name, skillId, orchestratorWorkspace } = input || {};
      if (typeof baseDir !== 'string' || !baseDir.trim()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'baseDir required');
      }
      const authorized = authorization ?? await authorize(req, res, baseDir);
      if (!authorized) return;
      const { trustedPickerImport } = authorized;
      const parsedOrchestratorWorkspace =
        parseOrchestratorWorkspace(orchestratorWorkspace);
      if (!parsedOrchestratorWorkspace.ok) {
        return sendApiError(
          res,
          400,
          'BAD_REQUEST',
          parsedOrchestratorWorkspace.message,
        );
      }
      const normalizedOrchestratorWorkspace = parsedOrchestratorWorkspace.value;
      const trimmedInput = baseDir.trim();
      if (!path.isAbsolute(path.normalize(trimmedInput))) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'baseDir must be absolute');
      }
      // Resolve symlinks once at import and persist the canonical path.
      // Without this, a user-controlled symlink (e.g. ~/sneaky → /etc) at
      // baseDir would let writeProjectFile escape the project sandbox at
      // every later call: resolveSafe checks the *literal* baseDir, but
      // the OS follows the symlink at write time. realpath() collapses
      // the chain so the stored baseDir == what the kernel will write to.
      let normalizedPath: string;
      try {
        normalizedPath = await fs.promises.realpath(trimmedInput);
      } catch {
        return sendApiError(res, 400, 'BAD_REQUEST', 'folder not found');
      }
      // realpath resolved → lstat the canonical path to ensure it's a
      // real directory, not another symlink (defense-in-depth).
      let dirStat;
      try {
        dirStat = await fs.promises.lstat(normalizedPath);
      } catch {
        return sendApiError(res, 400, 'BAD_REQUEST', 'folder not found');
      }
      if (!dirStat.isDirectory()) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'path must be a directory');
      }
      const rejection = await rootRejectionReason(normalizedPath, trustedPickerImport, normalizedOrchestratorWorkspace);
      if (rejection) return sendApiError(res, 400, 'BAD_REQUEST', rejection);

      const id = randomId();
      const now = Date.now();
      const projectName =
        typeof name === 'string' && name.trim()
          ? name.trim()
          : path.basename(normalizedPath);
      const entryFile = await detectEntryFile(normalizedPath);
      const skillValidation = await validateProjectSkillId(skillId);
      if (!skillValidation.ok) {
        return sendApiError(
          res,
          400,
          skillValidation.code,
          skillValidation.message,
        );
      }
      const cid = randomId();
      // Game creation reaches this with its own authorization and its request
      // still on `req`. A new game plans first, except the finished sample; a
      // plain import plans only when the folder is still empty.
      const createdFromTemplate = authorization ? (req.body as { templateId?: unknown } | undefined)?.templateId : undefined;
      const needsPlan = createdFromTemplate !== undefined
        ? createdFromTemplate !== GAME_SAMPLE_TEMPLATE_ID
        : !(await folderHoldsExistingWork(normalizedPath));
      const project = db.transaction(() => {
        const createdProject = insertProject(db, {
          id,
          name: projectName,
          skillId: skillValidation.id,
          pendingPrompt: null,
          metadata: {
            kind: 'prototype',
            baseDir: normalizedPath,
            importedFrom: 'folder',
            entryFile,
            ...(normalizedOrchestratorWorkspace
              ? { orchestratorWorkspace: normalizedOrchestratorWorkspace }
              : {}),
            ...(trustedPickerImport ? { fromTrustedPicker: true as const } : {}),
            ...(needsPlan ? { gamePlan: newGamePlan(now) } : {}),
            ...extraMetadata,
          },
          createdAt: now,
          updatedAt: now,
        });
        insertConversation(db, {
          id: cid,
          projectId: id,
          title: projectName,
          createdAt: now,
          updatedAt: now,
        });
        // Folder imports should land on Design Files so users can choose from
        // the imported folder's artifacts. Persist an empty saved tab state so
        // ProjectView does not auto-open the detected primary file on hydration.
        setTabs(db, id, [], null);

        return createdProject;
      })();
      /** @type {import('@openpixo/contracts').ImportFolderResponse} */
      const body = { project, conversationId: cid, entryFile };
      res.json(body);
    } catch (err: any) {
      sendApiError(res, 400, 'BAD_REQUEST', String(err?.message || err));
    }
  }

  return { authorize, inspectAuthorization, rootRejectionReason, importFolder };
}

export type FolderImporter = ReturnType<typeof createFolderImporter>;
