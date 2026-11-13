import path from 'node:path';
import type { Express, Response } from 'express';
import { StoreItemKindSchema, type MarketplacePluginEntry, type StoreCatalogQuery, type StoreCatalogResponse, type StoreInstallRequest, type StoreInstallResponse, type StorePurchaseRequest, type StorePurchaseResponse } from '@openpixo/contracts';
import type { RouteDeps } from '../server-context.js';
import { getProject } from '../db.js';
import { AccountError } from '../account/errors.js';
import { resolveProjectDir } from '../projects.js';
import { installWorkshopPack, PackInstallError } from '../store/pack-install.js';
import { sendApiError } from '../http/api-errors.js';
import { sendValidatedFile } from '../http/send-file.js';
import { registryRootsForDataDir } from '../plugins/registry.js';
import { findInstalledStorePlugin, resolveStoreCover, resolveStorePreview, storeCatalog, storeEntries, storeItemDetail } from '../store/catalog.js';
import { resolveMarketplaceEntryVersion } from '../registry/versioning.js';
import { installStoreItem } from '../store/install.js';
import { withBuiltInSkills, type BuiltInSkill } from '../store/built-in-skills.js';
import { isAgentToken } from '../http/tool-request-auth.js';
import { ownedStoreItems, purchaseStoreItem, StorePurchaseError, withOwnership, type StoreAccount } from '../store/purchase.js';
import { enableInstalledProjectExtension, ProjectExtensionError } from '../services/project-extensions.js';
import { catalogLocale, setProjectArtStyle } from '../styles/service.js';

export interface RegisterStoreRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'authorizeProjectRequest'> {
  /** Cloud account for credit purchases and ownership; absent when the build has no cloud. */
  account?: StoreAccount;
  /** Skills the agent already gets in every project; absent means none are marked. */
  builtInSkills?: () => Promise<BuiltInSkill[]>;
}

export function registerStoreRoutes(app: Express, ctx: RegisterStoreRoutesDeps): void {
  const { db, http, paths } = ctx;

  /**
   * A bought asset pack is downloaded into one project's `assets/packs/<pack>/`, with `pack.json` and
   * `PACK.md` saying what every image is for. The cloud decides ownership; installing never charges.
   */
  async function installPaidPack(res: Response, entry: MarketplacePluginEntry, projectId: string | undefined, version: string | undefined) {
    if (entry.kind !== 'asset-pack') return sendApiError(res, 422, 'VALIDATION_FAILED', 'Only asset packs can be bought and installed.');
    if (!projectId) return sendApiError(res, 400, 'BAD_REQUEST', 'Choose a game to add this pack to (projectId).');
    if (version && version !== entry.version) return sendApiError(res, 404, 'NOT_FOUND', 'Store item version not found');
    if (!ctx.account) return sendApiError(res, 503, 'STORE_PURCHASE_UNAVAILABLE', 'Sign in to download packs you own.');
    const project = getProject(db, projectId)!;
    let grant;
    try { grant = await ctx.account.storeDownload(entry.name, entry.version); } catch (error) {
      if (error instanceof AccountError && error.code === 'STORE_ITEM_NOT_OWNED') return sendApiError(res, 402, 'STORE_PURCHASE_REQUIRED', 'Buy this pack first.');
      if (error instanceof AccountError && error.code === 'ACCOUNT_SIGNED_OUT') return sendApiError(res, 401, 'UNAUTHORIZED', error.message);
      if (error instanceof AccountError && ['ACCOUNT_NOT_CONFIGURED', 'ACCOUNT_SECURE_STORAGE_UNAVAILABLE'].includes(error.code)) {
        return sendApiError(res, 503, 'STORE_PURCHASE_UNAVAILABLE', error.message);
      }
      return sendApiError(res, 503, 'UPSTREAM_UNAVAILABLE', new AccountError('CLOUD_UNAVAILABLE').message);
    }
    try {
      const installed = await installWorkshopPack({ grant, projectDir: resolveProjectDir(paths.PROJECTS_DIR, projectId, project.metadata) });
      return res.json({ name: entry.name, pluginId: entry.name, version: entry.version, projectId,
        folder: installed.folder, files: installed.files, warnings: [] } satisfies StoreInstallResponse);
    } catch (error) {
      if (error instanceof PackInstallError) return sendApiError(res, 502, 'UPSTREAM_UNAVAILABLE', error.message);
      throw error;
    }
  }
  app.get('/api/store/catalog', http.requireLocalDaemonRequest, async (req, res) => {
    const query: StoreCatalogQuery = {};
    for (const key of ['kind', 'engine', 'q', 'pricing'] as const) {
      const value = req.query[key];
      if (value === undefined) continue;
      if (typeof value !== 'string'
        || (key === 'kind' && !StoreItemKindSchema.safeParse(value).success)
        || (key === 'pricing' && value !== 'free' && value !== 'paid')) {
        return sendApiError(res, 400, 'BAD_REQUEST', `Invalid ${key} filter`);
      }
      Object.assign(query, { [key]: value });
    }
    const items = withBuiltInSkills(db, storeCatalog(db, query, catalogLocale(req.query.locale ?? req.headers['accept-language']), paths),
      await ctx.builtInSkills?.() ?? []);
    const owned = items.some(item => item.pricing.type === 'paid') ? await ownedStoreItems(ctx.account) : null;
    res.json({ items: items.map(item => withOwnership(item, owned)) } satisfies StoreCatalogResponse);
  });

  app.get('/api/store/items/:name/cover', http.requireLocalDaemonRequest, (req, res) => {
    const file = resolveStoreCover(db, String(req.params.name), paths);
    if (!file) return sendApiError(res, 404, 'NOT_FOUND', 'Store cover not found');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return sendValidatedFile(res, file);
  });

  app.get('/api/store/items/:name/previews/:index',http.requireLocalDaemonRequest, (req, res) => {
    const rawIndex = String(req.params.index);
    const index = /^(0|[1-9]\d*)$/.test(rawIndex) && String(Number(rawIndex)) === rawIndex ? Number(rawIndex) : -1;
    const file = resolveStorePreview(db, String(req.params.name), index, paths);
    if (!file) return sendApiError(res, 404, 'NOT_FOUND', 'Store preview not found');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return sendValidatedFile(res, file);
  });

  app.get('/api/store/items/:name',http.requireLocalDaemonRequest, async (req, res) => {
    const found = storeItemDetail(db, String(req.params.name), catalogLocale(req.query.locale ?? req.headers['accept-language']), paths);
    if (!found) return sendApiError(res, 404, 'NOT_FOUND', 'Store item not found');
    const item = withBuiltInSkills(db, [found], await ctx.builtInSkills?.() ?? [])[0] ?? found;
    res.json(withOwnership(item, item.pricing.type === 'paid' ? await ownedStoreItems(ctx.account) : null));
  });

  app.post('/api/store/purchase', http.requireLocalDaemonRequest, async (req, res) => {
    try {
      if (isAgentToken(req)) return sendApiError(res, 403, 'FORBIDDEN', 'Only the user can spend credits on store items');
      if (!http.isLocalSameOrigin(req, http.resolvedPortRef.current)) return sendApiError(res, 403, 'FORBIDDEN', 'local origin required');
      const body = req.body as Partial<StorePurchaseRequest> | undefined;
      if (!body || typeof body.name !== 'string' || !body.name.trim()
        || (body.version !== undefined && typeof body.version !== 'string')) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'name and optional version must be strings');
      }
      const found = storeEntries(db).find(({ entry }) => entry.name.toLowerCase() === body.name!.trim().toLowerCase());
      if (!found) return sendApiError(res, 404, 'NOT_FOUND', 'Store item not found');
      if (found.entry.pricing?.type !== 'paid') return sendApiError(res, 400, 'BAD_REQUEST', 'item is free; install it instead');
      const request: StorePurchaseRequest = { name: found.entry.name, ...(body.version !== undefined ? { version: body.version } : {}) };
      const result = await purchaseStoreItem(ctx.account, found.entry, request);
      return res.json(result satisfies StorePurchaseResponse);
    } catch (error) {
      return sendApiError(res, error instanceof StorePurchaseError ? error.status : 500,
        error instanceof StorePurchaseError ? error.code : 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });

  app.post('/api/store/install', http.requireLocalDaemonRequest, async (req, res) => {
    try {
      if (!http.isLocalSameOrigin(req, http.resolvedPortRef.current)) return sendApiError(res, 403, 'FORBIDDEN', 'local origin required');
      const body = req.body as Partial<StoreInstallRequest> | undefined;
      if (!body || typeof body.name !== 'string' || !body.name.trim()
        || (body.version !== undefined && (typeof body.version !== 'string' || !body.version.trim()))
        || (body.projectId !== undefined && (typeof body.projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(body.projectId)))) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'name, optional version and projectId are required strings');
      }
      const found = storeEntries(db).find(({ entry }) => entry.name.toLowerCase() === body.name!.trim().toLowerCase());
      if (!found) return sendApiError(res, 404, 'NOT_FOUND', 'Store item not found');
      const { entry, marketplace } = found;
      if (body.projectId) {
        if (!getProject(db, body.projectId)) return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
        if (!await ctx.authorizeProjectRequest(req, res, body.projectId, { mode: 'write', capability: 'writeFiles' })) return;
      }
      if (entry.pricing?.type === 'paid') return await installPaidPack(res, entry, body.projectId, body.version);
      const resolved = resolveMarketplaceEntryVersion(entry, body.version);
      if (!resolved || (resolved.version !== entry.version && !entry.versions?.some(version => version.version === resolved.version && !version.yanked))) {
        return sendApiError(res, 404, 'NOT_FOUND', 'Store item version not found');
      }
      // Top-level archive metadata belongs to the current catalog version only.
      const archive = resolved.version === entry.version ? entry.archive : undefined;
      const source = archive ? new URL(archive.url, marketplace.url).href : resolved.source;
      const integrity = archive?.integrity ?? resolved.archiveIntegrity;
      const bundled = marketplace.url.startsWith('bundled:');
      const shipped = bundled ? findInstalledStorePlugin(db, entry) : undefined;
      if (shipped?.sourceKind === 'bundled') {
        if (body.projectId && entry.kind === 'style') setProjectArtStyle(db, paths.PROJECT_ROOT, body.projectId, shipped.manifest.pixo?.style?.id ?? '');
        else if (body.projectId) await enableInstalledProjectExtension({
          dataDir: paths.RUNTIME_DATA_DIR, projectId: body.projectId, skillsRoots: [paths.USER_SKILLS_DIR, paths.SKILLS_DIR],
        }, entry.kind!, shipped.id);
        return res.json({ name: entry.name, pluginId: shipped.id, version: shipped.version,
          ...(body.projectId ? { projectId: body.projectId } : {}), warnings: [] } satisfies StoreInstallResponse);
      }
      const bundledPreset = bundled && entry.kind === 'mcp' && typeof entry.mcpTemplateId === 'string';
      if ((/^https:/i.test(source) || source.startsWith('github:')) && !integrity && !bundledPreset) {
        return sendApiError(res, 422, 'VALIDATION_FAILED', 'Store downloads require archive integrity');
      }
      for await (const event of installStoreItem(db, entry, {
        source, roots: registryRootsForDataDir(paths.RUNTIME_DATA_DIR),
        sourceMarketplaceId: marketplace.id, sourceMarketplaceEntryName: entry.name,
        sourceMarketplaceEntryVersion: resolved.version, marketplaceTrust: marketplace.trust,
        resolvedSource: source, ...(resolved.ref ? { resolvedRef: resolved.ref } : {}),
        ...(resolved.manifestDigest ? { manifestDigest: resolved.manifestDigest } : {}),
        ...(integrity ? { archiveIntegrity: integrity } : {}), lockfilePath: path.join(paths.RUNTIME_DATA_DIR, 'pixo-plugin-lock.json'),
      }, paths.RUNTIME_DATA_DIR, bundled)) {
        if (event.kind === 'error') return sendApiError(res, 422, 'VALIDATION_FAILED', event.message);
        if (event.kind !== 'success') continue;
        if (body.projectId && entry.kind === 'style') setProjectArtStyle(db, paths.PROJECT_ROOT, body.projectId, event.plugin.manifest.pixo?.style?.id ?? '');
        else if (body.projectId) await enableInstalledProjectExtension({
          dataDir: paths.RUNTIME_DATA_DIR, projectId: body.projectId, skillsRoots: [paths.USER_SKILLS_DIR, paths.SKILLS_DIR],
        }, entry.kind!, event.plugin.id);
        return res.json({ name: entry.name, pluginId: event.plugin.id, version: event.plugin.version,
          ...(body.projectId ? { projectId: body.projectId } : {}), warnings: event.warnings } satisfies StoreInstallResponse);
      }
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'Store installation did not finish');
    } catch (error) {
      return sendApiError(res, error instanceof ProjectExtensionError ? error.status : 500,
        error instanceof ProjectExtensionError ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
    }
  });
}
