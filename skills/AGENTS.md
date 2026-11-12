# skills

This directory holds **functional skills** — capabilities the agent
invokes mid-task to do work on user input. Each skill is a folder with a
`SKILL.md` (frontmatter + body) and any side files (`assets/`,
`references/`, scripts, …) the workflow needs.

The built-in catalogue contains focused skills for game implementation,
browser validation and game asset workflows. Keep additions within these game-workbench capabilities.

If the entry primarily *renders* an image, video, audio or real-time
GPU artifact, it belongs under `../design-templates/` instead. See
`specs/current/skills-and-design-templates.md` for the full split.

## Daemon plumbing

- Listed under `/api/skills` (functional only). User-imported skills
  shadow built-in entries with the same frontmatter `name`.
- Asset routes (`/api/skills/:id/example`, `/api/skills/:id/assets/*`)
  span both functional skills and design templates so existing
  `srcdoc`-rewritten URLs keep resolving after the split.
- Functional skills and renderable templates remain separate registries;
  consumers select the registry appropriate to the capability.

## Adding a skill

1. Create `skills/<my-skill>/SKILL.md` with `name`, `description`,
   `triggers`, and `pixo.mode: utility` frontmatter.
   If the workflow only applies to some engines, list them under `pixo.engines`
   (ids from `GAME_ENGINE_IDS`). The agent is told about every `utility` skill that
   fits the project's engine without anyone enabling it, so a wrong list hides a
   skill from a project or wastes prompt on one. No field means any engine.
2. Drop any side files alongside; reference them from the body using
   the relative-from-skill-root paths the daemon advertises in the
   skill preamble.
3. The daemon's lazy scanner picks the entry up on the next
   `/api/skills` request — no rebuild required during local dev.

## Resource scope

- Keep game-engine workflows, asset generation and processing, media
  providers, 3D/shader tooling, and the browser validation integration.
- General website, presentation, business-document, marketing, brand,
  Figma and designer-brief workflows are outside the built-in catalogue.
  Do not restore removed resources through a bulk catalogue seed.
- Every retained skill must contain an actionable method. A catalogue shell
  that only links to an upstream bundle is not shippable; catalogue discovery
  does not install missing workflows or dependencies.
