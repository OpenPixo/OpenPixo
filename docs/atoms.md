# Plugin atom metadata

The retained atom catalogue is metadata for plugin manifest validation and
discovery. Its source is
[`apps/daemon/src/plugins/atoms.ts`](../apps/daemon/src/plugins/atoms.ts).
`GET /api/atoms` returns that catalogue; `pixo doctor --json` includes it in the
`atoms` inventory.

The inherited daemon atom execution pipeline was removed in
[ADR 0012](adr/0012-slim-core.md). A catalogue row does not register a worker,
inject a bundled atom instruction body, or execute a plugin stage. Current agent
instructions use the shared game prompt described in
[`prompt-composition.md`](prompt-composition.md).

## Retained catalogue

| id | metadata label |
| --- | --- |
| `todo-write` | Todo write |
| `file-read` / `file-write` / `file-edit` | File operations |
| `research-search` | Research search |
| `media-image` / `media-video` / `media-audio` | Media generation |
| `code-import` | Code import |
| `rewrite-plan` | Rewrite plan |
| `patch-edit` | Patch edit |
| `build-test` | Build / test |
| `diff-review` | Diff review |
| `handoff` | Handoff |

Each row carries an id, label, description, status and task-kind metadata.
The retained `implemented` / `planned` status and the inherited task-kind names
are manifest metadata, not a list of current product entry points or daemon
executors. Read the source catalogue for the exact values.

## Validation and simulation

- [`apps/daemon/src/plugins/doctor.ts`](../apps/daemon/src/plugins/doctor.ts) checks atom ids
  in `pixo.context.atoms` and `pixo.pipeline.stages[].atoms`, reports unknown
  ids, and validates stage `until` expressions.
- [`packages/plugin-runtime`](../packages/plugin-runtime/src/index.ts) parses
  and validates portable plugin manifests.
- [`apps/daemon/src/plugins/simulate.ts`](../apps/daemon/src/plugins/simulate.ts) evaluates
  pipeline convergence against caller-supplied signals without running an
  agent. The expression grammar lives in
  [`apps/daemon/src/plugins/until.ts`](../apps/daemon/src/plugins/until.ts).

Use `pixo plugin validate <folder> --json` for an unfinished bundle and
`pixo plugin doctor <id> --json` for an installed plugin. Simulation validates
the manifest's convergence rules; it does not demonstrate a live executor.

## Updating the metadata

Keep catalogue changes aligned with manifest validation and discovery. A new
user-facing capability still needs its own HTTP contract, UI and CLI surfaces
under the root [`AGENTS.md`](../AGENTS.md) rules; adding an atom id alone does
not provide those surfaces.
