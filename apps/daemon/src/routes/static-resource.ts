import type { Express, Response } from 'express';
import type Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

import { detectAgents, detectAgentsStream, getDetectedAgents, getDetectedAgentsStream } from '../agents.js';
import { registerAgentCapabilityRoutes } from './agent-capabilities.js';
import {
  SkillImportError,
  deleteUserSkill,
  findSkillById,
  importUserSkill,
  listSkills,
  listSkillFiles,
  splitDerivedSkillId,
  updateUserSkill,
} from '../skills.js';

import { sendValidatedFile } from '../http/send-file.js';
import { parseFrontmatter } from '../services/frontmatter.js';
import { catalogLocale, localizeExamples } from '../styles/service.js';

import { listPromptTemplates, readPromptTemplate } from '../media/prompt-templates.js';
import { readAppConfig } from '../app-config.js';
import {
  installFromTarget,
  sanitizeRepoName,
  uninstallById,
} from '../services/skill-local-installation.js';
import {
  installSkillFromRemoteSource,
  type SkillInstallErrorCode,
} from '../services/skill-installation.js';
import type { RouteDeps } from '../server-context.js';
import { findRealElementRange, HTML_TAG_PATTERNS } from '@openpixo/contracts/runtime/html-injection-points';

export interface RegisterAtomRoutesDeps {
  db: Database.Database;
  resources: { FIRST_PARTY_ATOMS: Array<{ id: string; taskKinds: string[]; [key: string]: unknown }> };
}

export interface RegisterStaticResourceRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'resources'> {
  /** Settled, TTL-bounded authority for pure local catalog reads. */

  /** Fresh authority for mutations, materialization, and detail reads. */

  tokenContractRebuild?: {
  };
  /** Team-resource copy red-line (D3). When present, a frozen team skill cannot
   *  be edit-shadowed into a personal editable copy. Omit to skip (no-op). */

}

export function registerAtomRoutes(app: Express, ctx: RegisterAtomRoutesDeps) {
  const { db } = ctx;
  const atoms = ctx.resources.FIRST_PARTY_ATOMS ?? [];

  app.get('/api/atoms', (_req, res) => {
    res.json({ atoms: atoms.map((a) => ({ ...a, taskKinds: a.taskKinds.slice() })) });
  });
}

export function registerStaticResourceRoutes(app: Express, ctx: RegisterStaticResourceRoutesDeps) {
  registerAgentCapabilityRoutes(app, ctx);
  const { db } = ctx;
  const {
    RUNTIME_DATA_DIR,
    RUNTIME_DATA_DIR_CANONICAL,
    PROJECT_ROOT,
    DESIGN_TEMPLATES_DIR,
    USER_DESIGN_TEMPLATES_DIR,
    SKILLS_DIR,
    USER_SKILLS_DIR,
    PROMPT_TEMPLATES_DIR,
  } = ctx.paths;
  const {
    listAllSkills,
    listAllTemplates,
    listAllSkillLikeEntries,
    mimeFor,
  } = ctx.resources;
  const { isLocalSameOrigin, resolvedPortRef, sendApiError } = ctx.http;
    const requireLocalOrigin = (req: any, res: any) => {
    if (isLocalSameOrigin(req, resolvedPortRef.current)) return true;
    sendApiError(res, 403, 'FORBIDDEN', 'local origin required');
    return false;
  };
  const readSkillIdFromDirectory = (directory: string): string | null => {
    try {
      const raw = fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8');
      const parsed = parseFrontmatter(raw) as { data?: { name?: unknown } };
      return typeof parsed.data?.name === 'string' && parsed.data.name.trim()
        ? parsed.data.name.trim()
        : null;
    } catch {
      return null;
    }
  };
      const removeFreshSkillInstall = (directory: string): void => {
    try {
      const stat = fs.lstatSync(directory);
      if (stat.isSymbolicLink()) fs.unlinkSync(directory);
      else fs.rmSync(directory, { recursive: true, force: true });
    } catch {}
  };
      // Gate a mutation route for a skill bound into `workspace_resources`. Only
  // applies when the skill actually carries a binding row (installed/imported
  // through the workspace-aware routes above after this shipped) — an unbound
  // legacy skill stays outside the isolation regime, mirroring the plugin
  // uninstall route's same conditional gate.

  app.get('/api/agents', async (req, res) => {
    const wantsStream =
      req.query.stream === '1' || req.query.stream === 'true';
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    let config;
    try {
      config = await readAppConfig(RUNTIME_DATA_DIR);
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
      return;
    }
    const agentCliEnv = config.agentCliEnv ?? {};

    if (!wantsStream) {
      try {
        const list = await (refresh ? detectAgents : getDetectedAgents)(agentCliEnv);
        res.json({ agents: list });
      } catch (err: any) {
        res.status(500).json({ error: String(err) });
      }
      return;
    }

    // Server-Sent Events: emit each agent as its probe settles so the client
    // can paint cards incrementally instead of waiting for the slowest CLI.
    // Each `agent` event carries one AgentInfo; a terminal `done` event lets
    // the client distinguish "stream finished" from a dropped connection.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });
    try {
      for await (const agent of (refresh ? detectAgentsStream : getDetectedAgentsStream)(agentCliEnv)) {
        if (aborted) break;
        res.write(`event: agent\ndata: ${JSON.stringify(agent)}\n\n`);
      }
      if (!aborted) {
        res.write('event: done\ndata: {}\n\n');
      }
    } catch (err: any) {
      if (!aborted) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
      }
    } finally {
      res.end();
    }
  });

  app.get('/api/skills', async (req, res) => {
    try {
      // Workspace-scoped (see `skillVisibleFromWorkspace` in skills.ts): a
      // skill imported into a different workspace than the caller's is
      // hidden, same one-way rule `GET /api/plugins` already applies.

            const skills = await listAllSkills();
      // Strip full body + on-disk dir from the listing — frontend fetches the
      // body via /api/skills/:id when needed (keeps the listing payload small).
      res.json({
        skills: skills.map(({ body, dir: _dir, ...rest }) => ({
          ...rest,
          examples: localizeExamples(rest.examples, catalogLocale(req.query.locale ?? req.headers['accept-language'])),
          hasBody: typeof body === 'string' && body.length > 0,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/skills/:id', async (req, res) => {
    try {

            const skills = await listAllSkills();
      const skill = findSkillById(skills, req.params.id);
      if (!skill) return res.status(404).json({ error: 'skill not found' });
      const { dir: _dir, ...serializable } = skill;
      res.json({ ...serializable, examples: localizeExamples(serializable.examples, catalogLocale(req.query.locale ?? req.headers['accept-language'])) });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Design templates — the rendering catalogue. Same shape as /api/skills
  // (so the web client can reuse SkillSummary types) but rooted at
  // DESIGN_TEMPLATE_ROOTS so the listing stays focused on template-style
  // entries without bleeding functional skills into the EntryView gallery.
  app.get('/api/design-templates', async (req, res) => {
    try {
      const templates = await listAllTemplates();
      res.json({
        designTemplates: templates.map(({ body, dir: _dir, ...rest }) => ({
          ...rest,
          examples: localizeExamples(rest.examples, catalogLocale(req.query.locale ?? req.headers['accept-language'])),
          hasBody: typeof body === 'string' && body.length > 0,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/design-templates/:id', async (req, res) => {
    try {
      const templates = await listAllTemplates();
      const template = findSkillById(templates, req.params.id);
      if (!template) return res.status(404).json({ error: 'design template not found' });
      const { dir: _dir, ...serializable } = template;
      res.json({ ...serializable, examples: localizeExamples(serializable.examples, catalogLocale(req.query.locale ?? req.headers['accept-language'])) });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/skills/import — write a new SKILL.md under USER_SKILLS_DIR
  // from a UI-supplied body. The next /api/skills request surfaces it
  // automatically because listSkills walks USER_SKILLS_DIR first.
  app.post('/api/skills/import', async (req, res) => {
    try {

      const requestedSkillId = typeof req.body?.name === 'string'
        ? req.body.name.trim()
        : '';

      const result = await importUserSkill(USER_SKILLS_DIR, req.body || {});

      const skills = await listAllSkills();
      const skill = findSkillById(skills, result.id);
      if (!skill) {
        return sendApiError(
          res,
          500,
          'INTERNAL_ERROR',
          'imported skill was not found in catalog',
        );
      }
      const { dir: _dir, body: _body, ...serializable } = skill;
      res.status(201).json({
        skill: {
          ...serializable,
          hasBody: typeof skill.body === 'string' && skill.body.length > 0,
        },
      });
    } catch (err: any) {
      if (err instanceof SkillImportError) {
        const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'BAD_REQUEST' ? 400 : 500;
        return sendApiError(res, status, err.code, err.message);
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  // PUT /api/skills/:id — update an existing user-managed skill's
  // SKILL.md (and, when the user edits a built-in for the first time,
  // clone its side files into USER_SKILLS_DIR/<slug>/ so subsequent
  // /api/skills/:id/{files,example,assets/*} requests keep resolving
  // the bundled assets/references/scripts/examples). See PR #955 review.
  app.put('/api/skills/:id', async (req, res) => {
    try {


      const skills = await listAllSkills();
      const skill = findSkillById(skills, req.params.id);
      if (!skill) {
        return sendApiError(res, 404, 'NOT_FOUND', 'skill not found');
      }


      // AC-9 copy red-line (D3): a frozen team skill cannot be edit-shadowed into
      // a personal editable copy. No-op until the resource-hub reports this skill
      // as a frozen team resource.


      const result = await updateUserSkill(USER_SKILLS_DIR, {
        ...(req.body || {}),
        id: skill.id,
        sourceDir: skill.dir,
      });

      const next = await listAllSkills();
      const updated = findSkillById(next, result.id);
      if (!updated) {
        return sendApiError(
          res,
          500,
          'INTERNAL_ERROR',
          'updated skill was not found in catalog',
        );
      }
      const { dir: _dir, body: _body, ...serializable } = updated;
      res.json({
        skill: {
          ...serializable,
          hasBody: typeof updated.body === 'string' && updated.body.length > 0,
        },
      });
    } catch (err: any) {

      if (err instanceof SkillImportError) {
        const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'BAD_REQUEST' ? 400 : 500;
        return sendApiError(res, status, err.code, err.message);
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  // GET /api/skills/:id/files — flat listing of the files that ship with
  // a skill. Used by the Settings → Skills detail panel to render the
  // file tree (capped server-side to keep payload bounded).
  app.get('/api/skills/:id/files', async (req, res) => {
    try {

            const skills = await listAllSkills();
      const skill = findSkillById(skills, req.params.id);
      if (!skill) {
        return sendApiError(res, 404, 'NOT_FOUND', 'skill not found');
      }
      const files = await listSkillFiles(skill.dir);
      res.json({ files });
    } catch (err: any) {
      sendApiError(res, 500, 'INTERNAL_ERROR', String(err));
    }
  });

  app.get('/api/prompt-templates', async (_req, res) => {
    try {
      const templates = await listPromptTemplates(PROMPT_TEMPLATES_DIR);
      res.json({
        promptTemplates: templates.map(({ prompt: _prompt, ...rest }) => rest),
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/prompt-templates/:surface/:id', async (req, res) => {
    try {
      const tpl = await readPromptTemplate(
        PROMPT_TEMPLATES_DIR,
        req.params.surface,
        req.params.id,
      );
      if (!tpl)
        return res.status(404).json({ error: 'prompt template not found' });
      res.json({ promptTemplate: tpl });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Pre-built example HTML for a skill — what a typical artifact from this
  // skill looks like. Lets users browse skills without running an agent.
  //
  // The skill's `id` (from SKILL.md frontmatter `name`) can differ from its
  // on-disk folder name (e.g. id `magazine-web-ppt` lives in `skills/guizang-ppt/`),
  // so we resolve the actual directory via listSkills() rather than guessing.
  //
  // Resolution order:
  //   1. Derived id (`<parent>:<child>`):
  //      <parentDir>/examples/<child>.html — pre-baked single-file sample.
  //      Subfolder layouts (e.g. live-artifact's
  //      `examples/<name>/template.html`) are intentionally not served:
  //      they still contain `{{data.x}}` placeholders that only the
  //      daemon-side renderer fills in, and serving the raw template
  //      would render visible placeholder braces in the gallery.
  //   2. <skillDir>/example.html — fully-baked static example (preferred)
  //   3. <skillDir>/assets/template.html  +
  //      <skillDir>/assets/example-slides.html — assemble at request time
  //      by replacing the `<!-- SLIDES_HERE -->` marker with the snippet
  //      and patching the placeholder <title>. Lets a skill ship one
  //      canonical seed plus a small content fragment, so the example
  //      never drifts from the seed.
  //   4. <skillDir>/assets/template.html — raw template, no content slides
  //   5. <skillDir>/assets/index.html — generic fallback
  //   6. First .html in <skillDir>/examples/ — used as a friendly fallback
  //      so a skill that aggregates examples (like live-artifact) still has
  //      a real preview on its parent card instead of returning 404.
  app.get('/api/skills/:id/example', async (req, res) => {
    try {
      // Span both functional skills and design templates: rendered example
      // HTML rewrites assets to /api/skills/<id>/... and we want those URLs
      // to keep resolving regardless of which root owns the backing folder
      // after the skills/design-templates split.

            const skills = await listAllSkillLikeEntries();

      // 1. Derived `<parent>:<child>` id — resolve straight to the matching
      // file under <parentDir>/examples/. Done before findSkillById so the
      // parent's normal fallback chain never accidentally serves a stale
      // file when a sample is missing (we'd rather 404 explicitly).
      const derived = splitDerivedSkillId(req.params.id);
      if (derived) {
        const parent = findSkillById(skills, derived.parentId);
        if (!parent) {
          return res.status(404).type('text/plain').send('skill not found');
        }
        const candidate = path.join(
          parent.dir,
          'examples',
          `${derived.childKey}.html`,
        );
        if (fs.existsSync(candidate)) {
          const html = await fs.promises.readFile(candidate, 'utf8');
          return res
            .type('text/html')
            .send(rewriteSkillAssetUrls(html, parent.id));
        }
        return res
          .status(404)
          .type('text/plain')
          .send('derived example not found');
      }

      const skill = findSkillById(skills, req.params.id);
      if (!skill) {
        return res.status(404).type('text/plain').send('skill not found');
      }

      const baked = path.join(skill.dir, 'example.html');
      if (fs.existsSync(baked)) {
        const html = await fs.promises.readFile(baked, 'utf8');
        return res
          .type('text/html')
          .send(rewriteSkillAssetUrls(html, skill.id));
      }

      const tpl = path.join(skill.dir, 'assets', 'template.html');
      const slides = path.join(skill.dir, 'assets', 'example-slides.html');
      if (fs.existsSync(tpl) && fs.existsSync(slides)) {
        try {
          const tplHtml = await fs.promises.readFile(tpl, 'utf8');
          const slidesHtml = await fs.promises.readFile(slides, 'utf8');
          const assembled = assembleExample(tplHtml, slidesHtml, skill.name);
          return res
            .type('text/html')
            .send(rewriteSkillAssetUrls(assembled, skill.id));
        } catch {
          // Fall through to raw template on read failure.
        }
      }
      if (fs.existsSync(tpl)) {
        const html = await fs.promises.readFile(tpl, 'utf8');
        return res
          .type('text/html')
          .send(rewriteSkillAssetUrls(html, skill.id));
      }
      const idx = path.join(skill.dir, 'assets', 'index.html');
      if (fs.existsSync(idx)) {
        const html = await fs.promises.readFile(idx, 'utf8');
        return res
          .type('text/html')
          .send(rewriteSkillAssetUrls(html, skill.id));
      }

      // Friendly fallback for skills that aggregate examples in a sibling
      // `examples/` folder (e.g. live-artifact). The parent card would
      // otherwise 404 even though plenty of perfectly valid samples ship
      // alongside SKILL.md; pick the first .html file alphabetically so
      // direct URL access (e.g. deep links) shows something representative.
      // Subfolder layouts are excluded for the same reason as the derived
      // resolver above — their `template.html` still has unresolved
      // `{{data.x}}` placeholders.
      const examplesDir = path.join(skill.dir, 'examples');
      if (fs.existsSync(examplesDir)) {
        let entries: string[] = [];
        try {
          entries = await fs.promises.readdir(examplesDir);
        } catch {
          entries = [];
        }
        entries.sort();
        for (const name of entries) {
          if (name.startsWith('.')) continue;
          if (!name.toLowerCase().endsWith('.html')) continue;
          const direct = path.join(examplesDir, name);
          try {
            const html = await fs.promises.readFile(direct, 'utf8');
            return res
              .type('text/html')
              .send(rewriteSkillAssetUrls(html, skill.id));
          } catch {
            continue;
          }
        }
      }

      res
        .status(404)
        .type('text/plain')
        .send(
          'no example.html, assets/template.html, assets/index.html, or examples/*.html for this skill',
        );
    } catch (err: any) {
      res.status(500).type('text/plain').send(String(err));
    }
  });

  // Static assets shipped beside a skill's example/template HTML. Lets the
  // example HTML reference `./assets/foo.png`-style paths that resolve
  // correctly when the response is loaded into a sandboxed `srcdoc` iframe
  // (where relative URLs would otherwise resolve against `about:srcdoc`).
  // The example response above rewrites `./assets/<file>` into a request
  // against this route; we still keep the on-disk paths human-friendly so
  // contributors can preview `example.html` straight from disk.
  app.get('/api/skills/:id/assets/*splat', async (req, res) => {
    try {
      // Same rationale as /example above — assets need to resolve whether
      // the owning skill folder lives under skills/ or design-templates/.

            const skills = await listAllSkillLikeEntries();
      const skill = findSkillById(skills, req.params.id);
      if (!skill) {
        return res.status(404).type('text/plain').send('skill not found');
      }
      const splatParam = (req.params as { splat?: string | string[] }).splat;
      const relPath = Array.isArray(splatParam) ? splatParam.join('/') : String(splatParam || '');
      const assetsRoot = path.resolve(skill.dir, 'assets');
      const target = path.resolve(assetsRoot, relPath);
      if (target !== assetsRoot && !target.startsWith(assetsRoot + path.sep)) {
        return res.status(400).type('text/plain').send('invalid asset path');
      }
      if (!fs.existsSync(target)) {
        return res.status(404).type('text/plain').send('asset not found');
      }
      // The example HTML is rendered inside a sandboxed iframe (Origin: null).
      // Mirror the project /raw route's allowance so the iframe can fetch the
      // image bytes; same-origin web callers do not need this header.
      if (req.headers.origin === 'null') {
        res.header('Access-Control-Allow-Origin', '*');
      }
      // Rooted at the skill's assets: the request names the path below it.
      sendValidatedFile(res.type(mimeFor(target)), target, assetsRoot);
    } catch (err: any) {
      res.status(500).type('text/plain').send(String(err));
    }
  });

  app.post('/api/skills/install', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {

      const body = req.body && typeof req.body === 'object' ? req.body : {};
            const isLegacyTarget =
        (body.source === 'github' && typeof body.url === 'string') ||
        (body.source === 'local' && typeof body.path === 'string');
      if (body.source === 'local' && typeof body.path === 'string') {
        const localSkillId = readSkillIdFromDirectory(body.path);

      }
      const result = isLegacyTarget
        ? await installFromTarget(body, USER_SKILLS_DIR, 'skill')
        : await installSkillFromRemoteSource(
            USER_SKILLS_DIR,
            typeof body.source === 'string' ? body.source : '',
            {

            },
          );
      if (!result.ok) {
        const statusByCode: Partial<Record<SkillInstallErrorCode, number>> = {
          BAD_REQUEST: 400,
          FETCH_FAILED: 502,
          INVALID_ARCHIVE: 400,
          INVALID_MANIFEST: 400,
          CONFLICT: 409,
          INTERNAL_ERROR: 500,
        };
        const code = 'code' in result ? result.code : undefined;
        return res
          .status((code && statusByCode[code]) || 400)
          .json({ error: result.error, ...(code ? { code } : {}) });
      }
      if (typeof result.dir !== 'string' || !result.dir) {
        return res.status(500).json({ error: 'skill install did not return an installation directory' });
      }
      const installedSkillId = 'id' in result && typeof result.id === 'string'
        ? result.id
        : readSkillIdFromDirectory(result.dir);

      const installedDir = fs.realpathSync.native(result.dir);
      const unscopedSkills = await listAllSkills();
      const installed = unscopedSkills.find(
        (candidate) => fs.realpathSync.native(candidate.dir) === installedDir,
      );
      if (!installed) {
        return res.status(500).json({ error: `installed skill was not found in catalog: ${result.dir}` });
      }

      const scopedSkills = await listAllSkills();
      const skill = findSkillById(scopedSkills, installed.id);
      if (!skill) {
        return res.status(500).json({ error: 'installed skill was not found in scoped catalog' });
      }
      res.json({
        skill: {
          ...skill,
          dir: undefined,
          body: undefined,
          hasBody: typeof skill.body === 'string' && skill.body.length > 0,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

  // This route used to carry NO permission check at all: any caller (any
  // workspace, any role) could delete any skill, including one installed by
  // someone else or pulled in from a team share. Now gated the same way
  // `POST /api/plugins/:id/uninstall` is, via the shared
  // `enforceWorkspaceResourceMutation` — see `enforceSkillWorkspaceMutation`
  // above for the "only when a binding row exists" conditional.
  app.delete('/api/skills/:id', async (req, res) => {
    if (!requireLocalOrigin(req, res)) return;
    try {


      const skills = await listAllSkills();
      const skill = findSkillById(skills, req.params.id);
      if (!skill) {
        return sendApiError(res, 404, 'NOT_FOUND', 'skill not found');
      }


      const result = await uninstallById(req.params.id, USER_SKILLS_DIR, SKILLS_DIR, 'skill');
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
      // Clean up the binding row too — `workspace_resources` has no
      // FOREIGN KEY ... ON DELETE CASCADE (see db.ts's doc comment on the
      // table), so skipping this would leave an orphan binding that
      // re-importing the same skill id would find and silently reuse (stale
      // workspace/visibility). A DELETE against a row that never existed is a
      // no-op.

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: String(err) });
    }
  });

}

export function assembleExample(templateHtml: string, slidesHtml: string, title: string) {
  // Function replacements: string replacements would expand `$$`, `$&`, `$``,
  // and `$'` inside the skill-derived inputs via String.prototype.replace's
  // GetSubstitution (#6795).
  const withSlides = templateHtml.replace('<!-- SLIDES_HERE -->', () => slidesHtml);
  // Retitle the template's own <title>. The slides just interpolated above are
  // skill-authored and can carry a <title> of their own, which a text match
  // would rewrite instead (inherited issue #7410).
  // The close is located by the raw-text rule rather than searched for as text
  // from the open tag's own start — from there a `</title` sitting in one of
  // its attribute values would match first.
  const range = findRealElementRange(withSlides, HTML_TAG_PATTERNS.titleOpen, 'title');
  if (!range) return withSlides;
  return `${withSlides.slice(0, range.start)}<title>${title} | OpenPixo Example</title>`
    + withSlides.slice(range.end);
}

export function rewriteSkillAssetUrls(
  html: string,
  skillId: string,
  workspaceQuery = '',
) {
  if (typeof html !== 'string' || html.length === 0) return html;
  return html.replace(
    /(\s(?:src|href)\s*=\s*)(['"])((?:\.\.\/([^/'"#?]+)\/)?(?:\.\/)?assets\/([^'"#?]+))(\2)/gi,
    (_match, attr, openQuote, _fullPath, siblingSkillId, relPath, closeQuote) => {
      const resolvedSkillId = siblingSkillId || skillId;
      const prefix = `/api/skills/${encodeURIComponent(resolvedSkillId)}/assets/`;
      return `${attr}${openQuote}${prefix}${relPath}${workspaceQuery}${closeQuote}`;
    },
  );
}
