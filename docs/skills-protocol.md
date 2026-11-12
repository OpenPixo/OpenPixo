# Skills Protocol

**Product scope:** First release (openpixo-internal: `docs/FIRST-RELEASE-SCOPE.md`) · **Siblings:** [`skills-contributing.md`](skills-contributing.md) · [`architecture.md`](architecture.md) · [`agent-adapters.md`](agent-adapters.md) · [`modes.md`](modes.md)

> Want to author a skill rather than read the protocol spec? See [`skills-contributing.md`](skills-contributing.md) — quick start, merge bar, PR template, common rejections. This file is the **what** (frontmatter grammar, discovery rules, mode semantics); that file is the **how** (clone to merged PR).

A **Skill** is an atomic functional capability in OpenPixo. A **design template** is a rendering-catalogue entry. Both use Claude Code's `SKILL.md` convention as their portable instruction format and may add `pixo:` metadata, but they have different ownership and APIs: functional skills live in `skills/` and `/api/skills`; rendering templates live in `design-templates/` and `/api/design-templates`.

> **Portable format:** A bundle that contains `SKILL.md` remains readable by agents that support the Agent Skills format. Installation and catalogue placement are separate concerns. The built-in catalogue now retains game capabilities and media production; see [`design-templates/AGENTS.md`](../design-templates/AGENTS.md) and [ADR 0012](adr/0012-slim-core.md).

---

## 1. Base format (unchanged from Claude Code)

Every skill is a directory containing at minimum a `SKILL.md`:

```
<skill-root>/
├── SKILL.md              # manifest + workflow instructions
├── assets/               # templates, images, boilerplate the skill writes
│   └── …
└── references/           # knowledge files the skill reads during planning
    ├── components.md
    ├── layouts.md
    └── …
```

`SKILL.md` front-matter (YAML):

```yaml
---
name: game-key-art
zh_name: "游戏主视觉"
en_name: "Game Key Art"
description: |
  Produce game key art from a character and environment brief.
zh_description: "根据角色和环境描述生成游戏主视觉。"
en_description: |
  Produce game key art from a character and environment brief.
triggers:
  - "game key art"
  - "游戏主视觉"
---
```

Body is free-form Markdown that describes the workflow the agent should follow — typically a numbered step list plus checks. See [`image-poster/SKILL.md`](../design-templates/image-poster/SKILL.md) for a retained media workflow.

**OpenPixo reads all of this as-is.** No changes required.

## 2. OpenPixo extensions (optional)

Skills can declare additional front-matter fields to unlock OpenPixo-specific UI. All fields are optional; absent fields fall back to sensible defaults.

```yaml
---
name: game-key-art
description: …
triggers: […]

# --- OpenPixo extensions below this line ---

pixo:
  mode: image                       # utility | prototype | image | video | audio for new game bundles
  surface: image                    # web | image | video | audio
  scenario: game-assets             # gallery/filter hint
  category: key-art                 # free-form lowercase filter slug
  preview:
    type: html                      # registry preview hint
  example_prompt: "Create key art for my woodland exploration game."
  example_prompt_i18n:
    zh-CN: "为我的林地探索游戏生成主视觉。"
---
```

### 2.1 What OpenPixo uses each field for

| Field | Used by |
|---|---|
| `zh_name` / `en_name` | localized picker title; falls back to `name` |
| `zh_description` / `en_description` | localized picker description; falls back to `description` |
| `pixo.mode` | registry classification and creation-surface filtering; new functional game helpers use explicit `utility` rather than inferred media keywords |
| `pixo.surface` | web/image/video/audio surface filtering; defaults from media mode or to `web` |
| `pixo.platform` | optional desktop/mobile gallery hint |
| `pixo.scenario` / `pixo.category` | scenario and category filter hints |
| `pixo.preview.type` | picking the right iframe renderer |
| `pixo.example_prompt` | English fallback starter prompt used by picker CTA |
| `pixo.example_prompt_i18n` | localized starter prompt map (for example `zh-CN`) |
| `pixo.default_for`, `pixo.featured` | creation defaults and gallery ordering hints |
| `pixo.fidelity`, `pixo.speaker_notes`, `pixo.animations` | optional fast-create defaults for matching template kinds |

Older bundles may also carry fields such as `pixo.inputs`, `pixo.parameters`,
`pixo.outputs`, `pixo.capabilities_required`, `pixo.design_system`, `pixo.craft`
or `pixo.critique`. The skill registry preserves the
portable `SKILL.md` body but does not use those fields to render forms, sliders,
choose output files, or gate an agent. The Agent-Skill-to-plugin adapter can
translate or retain some of that metadata; plugin behavior is specified in
[`plugins-spec.md`](plugins-spec.md), not by this registry protocol.

### 2.2 If a skill omits `pixo:` entirely

Defaults:
- `mode`: inferred from description and body, falling back to `prototype`
- `surface`: the media mode for image/video/audio entries, otherwise `web`
- `preview.type`: `html`
- `example_prompt`: the first sentence of `description`, capped for the picker
- `scenario`: inferred from description/body, falling back to `general`

The goal: **zero-config compatibility** for existing Claude Code skills.

## 3. Skill discovery & precedence

The daemon keeps functional skills and rendering templates in separate
registries:

| Registry | Roots, highest priority first | API |
|---|---|---|
| Functional skills | user-managed skills, then bundled `skills/` | `/api/skills` |
| Design templates | user-managed templates, then bundled `design-templates/` | `/api/design-templates` |

The user-managed roots derive from the resolved daemon data root; this file
intentionally does not restate a concrete path. A duplicate frontmatter `name`
in the first root shadows the bundled entry without deleting it. Each listing
request rescans its roots, so local changes appear without a watcher, `SIGHUP`,
or daemon restart. Chat-time lookup spans both registries so projects saved
against a design-template id continue to compose its instructions.

### Runtime resource staging

OpenPixo does not distribute an active bundle by symlinking it into every
agent's global configuration. Before a project run, the daemon makes a real
copy of every active skill/template with side files under the project's
`.pixo-skills/` alias. The prompt preamble advertises that CWD-relative copy and
an absolute fallback. This keeps references and assets reachable across
agents, including filesystems where symlink or cross-device rename semantics
differ. A local skill installation may itself be represented by a managed
link, but that storage detail is separate from per-run staging.

## 4. Registry modes

The daemon's [`skills.ts`](../apps/daemon/src/skills.ts) normalizes `pixo.mode`
to one of eight metadata values. They do not select a prompt composer or imply
that a matching built-in catalogue family exists. Current product
classifications are described in [`modes.md`](modes.md).

### 4.1 `prototype`

- **Portable bundle use:** interactive game previews, shaders and canvases.
- **Preview:** `html` or `jsx`.
- **Primary output:** `index.html` or `Prototype.jsx`.
- **Bundled catalogue:** no generic WebGL hero preset. Game implementation workflows live under [`skills/`](../skills/).

### 4.2 Legacy metadata: `deck`, `template`, `design-system`

The parser still accepts these labels in portable bundles. Their inherited
built-in layout families and design-system domain were removed; acceptance of
a label does not restore a creation tab, composer, import flow or export path.
Do not use them to extend the retired catalogue.

### 4.3 `utility`

Functional game skills use this label for work such as implementation, asset
processing, packaging and validation. Their output is defined by the workflow.

### 4.4 `image`, `video`, and `audio`

- **Purpose:** classify media-generation instruction bundles for the Media creation surface.
- **Surface:** defaults to the matching media kind unless `pixo.surface` overrides it.
- **Inputs:** provider/model controls and media-specific metadata are owned by the Media UI and shared contracts.
- **Examples:** `image-poster`, `video-shortform`, `hyperframes`, and `audio-jingle`.

## 5. Skill context in the game prompt

Every project uses the shared game prompt, with explicit enabled-skill inputs;
see [`prompt-composition.md`](prompt-composition.md). The retired design-system,
craft and Critique Theater domains no longer compose their former context into
it. A workflow may read a project-owned `DESIGN.md` as an ordinary workspace
file when the task needs it; that does not require a daemon design-system
registry or legacy metadata switch.

## 6. Skill inspection and distribution

```sh
pixo skills list
# → id and display label for entries returned by /api/skills

pixo skills show <id>
# → the daemon's JSON representation of one skill

pixo skill install github:owner/repo
pixo skill install https://example.com/my-skill.tar.gz
# → installs one public skill bundle through POST /api/skills/install
```

Remote skill import accepts the same source grammar as Plugin URL import:
`github:owner/repo` or a public HTTPS `.tar.gz` / `.tgz` archive containing one
top-level `SKILL.md`. Downloads are size-capped and reject private-network
targets, path traversal, symbolic/hard links, malformed manifests, and
duplicate skill ids. An intentional replacement is explicit: uninstall the
existing user skill first, then install the new bundle. `pixo skills` remains the
compatibility alias for list/show/install/uninstall. Repository-owned
functional skills and rendering templates still live under `skills/` and
`design-templates/` respectively. Do not document a concrete daemon-managed
install path here; the root `AGENTS.md` **Daemon data directory contract** is
the only path authority.

## 7. Worked example — using the bundled image template

The retained image workflow ships at
[`design-templates/image-poster/`](../design-templates/image-poster/):

1. The daemon lists it through `/api/design-templates`, independently of the
   functional `/api/skills` registry.
2. The user selects the image template from the resource catalogue and supplies
   a game-art brief.
3. OpenPixo stores the selected template id as the project's primary
   `skillId`. The daemon's combined skill-like resolver loads that template's
   `SKILL.md` and resources through the shared game prompt path.
4. The agent follows the template workflow and the media contract to generate
   the requested image into the project workspace.
5. The resulting project file appears in the UI for preview and handoff.

The protocol intentionally does not define the workspace's concrete path; read
the root `AGENTS.md` **Daemon data directory contract** before changing or
documenting artifact storage.

## 8. Writing a rendering template — minimal example

```
design-templates/game-key-art/
├── SKILL.md
└── example.html
```

```markdown
---
name: game-key-art
description: |
  Produce game key art from a character and environment brief.
triggers:
  - "game key art"
  - "游戏主视觉"
pixo:
  mode: image
  surface: image
  scenario: game-assets
  preview:
    type: html
  example_prompt: "Create key art for my woodland exploration game."
---

# Workflow

1. Read the active project's media metadata and the user's game-art brief.
2. Compose the subject, environment, framing, palette and constraints.
3. Generate the image through the shared media contract using `pixo media`.
4. Verify the returned project file and hand off its filename.
```

## 9. Testing skills

There is no `pixo skills test` command and no runtime contract for a
`tests/basic.prompt` tree. Repository-owned entries are checked by the root
guard, localized-content coverage, registry tests, and any focused tests for
their assets or prompt behavior. Run at least `pnpm guard` and
`pnpm typecheck`, plus the package-scoped checks appropriate to the files
changed. Plugin bundles have their own validation and doctor surfaces.

## 10. Open questions

- **Skill provenance.** URL-imported functional skills do not yet persist their
  source after installation; richer provenance, integrity pinning, and trust
  UI should reuse the plugin model instead of growing a second incompatible
  one.
- **Skill composition.** Can one game workflow invoke another capability for a
  sub-artifact? The current registries treat them as
  leaf-level inputs; composition requires an explicit orchestration contract.
- **Richer skill inputs.** Typed apply-time inputs and deferred parameters now
  belong to the plugin manifest contract. A future skill-native form should
  reuse that contract rather than reviving a second slider schema.
