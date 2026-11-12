# design-templates

This directory holds reusable **design templates** for game image, video
and audio production. The retained inventory and consumer evidence live in
[`PHASE1-CATALOG-REVIEW.md`](../docs/coordination/PHASE1-CATALOG-REVIEW.md).
Each entry contains a `SKILL.md` (same shape as functional skills) plus rendering side files
(`example.html`, `assets/`, `references/`, …).

If the entry primarily *does work* on user input — game implementation,
asset processing or validation — it belongs under `../skills/` instead.
See `specs/current/skills-and-design-templates.md` for the full split.

## Daemon plumbing

- Listed under `/api/design-templates`. The shape mirrors `/api/skills`
  (same `SkillSummary`/`SkillDetail` types) so the web client can
  reuse a single `SkillSummary[]` consumer for both surfaces.
- Asset and example routes (`/api/skills/:id/example`,
  `/api/skills/:id/assets/*`) intentionally span both registries — the
  example HTML rewrites to `/api/skills/<id>/...` regardless of which
  root owns the folder, so URLs keep resolving after the split.
- Functional skills and renderable templates remain separate registries;
  consumers select the registry appropriate to the capability.

## Adding a design template

1. Create `design-templates/<my-template>/SKILL.md` with `name`,
   `description`, `triggers`, and an explicit `pixo.mode` (one of
   `image`, `video`, `audio`, or `prototype` for a real-time GPU artifact).
2. Ship a baked `example.html` (and any side files) so the shared example and
   asset routes have preview content to serve.
3. Optionally drop additional baked samples under `examples/<key>.html`
   to surface them as derived `<parent>:<key>` cards.

## Resource scope

Keep game media-production workflows with current consumers. General
website, presentation, business, marketing and brand layout presets,
including standalone WebGL hero showcases, are outside the built-in
catalogue. A visual style alone does not establish a game or
asset-production capability.
