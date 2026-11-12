# Creation surfaces and skill modes

**Product scope:** First release (openpixo-internal: `docs/FIRST-RELEASE-SCOPE.md`) · **Siblings:** [`architecture.md`](architecture.md) · [`skills-protocol.md`](skills-protocol.md) · [`agent-adapters.md`](agent-adapters.md)

OpenPixo has two related taxonomies:

- **Project creation** starts a game from an engine template, imports an
  existing folder, or creates an Image, Video, or Audio media project.
- The daemon accepts `utility`, `prototype`, `deck`, `template`,
  `design-system`, `image`, `video`, or `audio` as `SKILL.md` registry metadata.
  An accepted mode does not create a matching product surface.

They are intentionally not one-to-one. Creation surfaces describe the workflow a user
starts; skill modes describe how the daemon indexes and routes an instruction
bundle. Game creation lives in
[`NewGameDialog.tsx`](../apps/web/src/components/NewGameDialog.tsx), folder import in
[`useOpenFolderImport.ts`](../apps/web/src/components/useOpenFolderImport.ts), and
media creation in
[`NewProjectPanel.tsx`](../apps/web/src/components/NewProjectPanel.tsx). The
daemon parser and normalization rules live in
[`skills.ts`](../apps/daemon/src/skills.ts).

| Creation surface | Project metadata | Skill routing | Main distinction |
|---|---|---|---|
| **New game** | `kind: prototype` plus detected engine metadata | Shared game prompt and enabled project resources | Engine template and destination folder |
| **Open folder** | Imported workspace metadata | Shared game prompt and enabled project resources | Work in the selected existing directory |
| **Media** | `kind: image`, `video`, or `audio` | Matching media-mode skill | Provider/model, aspect, duration, voice, and prompt-template controls |

The persisted `prototype` kind is displayed as **Game**. Older project kinds
remain readable and use the generic project badge; they do not restore retired
design creation tabs. Prototype/deck/other forms, fidelity and platform hints,
landing-page options, and Claude Design ZIP import have been removed.

## Media

Media groups three surfaces:

- **Image:** model and aspect ratio, plus an optional image prompt template.
- **Video:** model, aspect ratio, duration, and an optional video prompt
  template. The `hyperframes-html` model pins the HyperFrames skill.
- **Audio:** speech or sound, model, duration, and an optional voice for speech.

Media skill selection matches either the skill's mode or surface.

## Maintenance rules

- When a creation surface changes, update its metadata construction,
  title/auto-name mappings, analytics target mapping, and this
  document together.
- When a skill mode changes, update the daemon's `SkillMode` parser, contract
  documentation, relevant catalogue entries, and UI filters together.
- Do not describe bundled rendering templates as functional skills. They live
  under `design-templates/` and are listed through `/api/design-templates`;
  functional capabilities live under `skills/` and are listed through
  `/api/skills`.
- Keep user-facing capabilities reachable through both the web UI and `pixo` CLI,
  following the repository-wide dual-track rule in the root `AGENTS.md`.

## Related implementation

- UI creation model:
  [`apps/web/src/components/NewProjectPanel.tsx`](../apps/web/src/components/NewProjectPanel.tsx)
- Skill registry and mode normalization:
  [`apps/daemon/src/skills.ts`](../apps/daemon/src/skills.ts)
- Shared project API contracts:
  [`packages/contracts/src/api/projects.ts`](../packages/contracts/src/api/projects.ts)
- Skill and rendering-template protocol:
  [`docs/skills-protocol.md`](skills-protocol.md)
