# ADR 0006: Maintain OpenPixo as a full hard fork of OpenDesign

Date: 2026-10-25. Status: accepted by the user's explicit decision
(roadmap §7 (openpixo-internal: `docs/OPENPIXO-ROADMAP.zh-CN.md`), item 1).

Supersedes the parts of [ADR 0005](0005-openpixo-fork.md) that limit the
fork to "only the game-project workflow and behavior required by the frozen
first-release scope". ADR 0005's identity, licensing, telemetry and
no-upstream-feed rules remain in force.

Library protection is superseded by the owner's [slim-core Batch 9 decision](../coordination/SLIM-CORE.md#batch-9--game-copy): the unused global Library UI, API and CLI are removed; project assets remain independent. The original decision below is historical context.

## Context

OpenPixo was forked from `nexu-io/open-design` at
`9724c44142ea0afaee3d207f37901b31c66a44ad` (0.25.1). The confirmed roadmap
(v0.2 game harness, assets and generation studio; v0.3 accounts, credits and
hosted generation; v0.4 store) moves the product away from a design tool.
Most inherited product surfaces (design systems, deck templates, Figma
migration, Orbit, brands, Vela cloud, team collab, Web Clipper) have no
OpenPixo use. Keeping them merge-compatible with upstream would constrain
deletion and restructuring, while merging an 18k-line `server.ts` and a
12k-line `cli.ts` on every upstream release would be costly.

## Decision

OpenPixo no longer merges or rebases onto upstream OpenDesign. The pinned
commit is the last shared ancestor. OpenPixo may restructure, rename and
delete any inherited code.

- **Attribution stays.** Keep `LICENSE`, `NOTICE`, upstream copyright lines
  and every bundled component's own license. Changed files stay under
  Apache-2.0 obligations.
- **Upstream is a reference, not a source of truth.** Upstream fixes are ported
  by hand when they matter. The highest-value watch list is the agent runtime
  layer: `apps/daemon/src/runtimes/defs/`, `runtimes/claude-stream.ts`,
  `runtimes/json-event-stream.ts`, `apps/daemon/src/agent-protocol/`, and
  `mocks/`. A ported runtime change is accepted only after it replays against
  recorded CLI sessions (`mocks/`,
  `apps/daemon/tests/fixtures/claude-cli-recordings/`) or a fresh recording of
  the CLI version being supported.
- **Delete one domain at a time.** Each removal is its own change, followed by
  `pnpm guard`, `pnpm typecheck` and the focused tests of the affected
  packages. Product surfaces are first hidden behind product switches, then
  deleted. Do not delete the runtime adapters, sidecar/platform packages,
  plugin core, media pipeline, Library or packaging control planes.
- **Internal names may stay.** `@open-design/*` packages, the `od` binary,
  `OD_*` variables, persisted keys and protocol names remain until a dedicated
  migration plan covers existing user data and installed builds. The hard fork
  permits renaming but does not require it.
  **Superseded by [ADR 0011](0011-remove-upstream-identifiers.md):** the owner
  confirmed removal before users or released builds exist, with no aliases,
  compatibility readers or data migrations. The original decision above is
  preserved as history; the ADR 0008/0009/0010 notes below remain intact.
- **Upstream repository process rules no longer bind OpenPixo.** The Plane
  title gate and its bypass reviewers, the beta/prerelease/preview/stable
  channel model with Feishu notifications, ODCrew, the Docker image workflow
  and upstream PR-duty notes describe the OpenDesign organization. Trimming
  them from root `AGENTS.md` and `.github/` is a separate documentation and
  automation change. Until that change lands, engineering rules that protect
  code (data directory contract, run start choke point, UI/CLI dual track,
  contracts purity, test locations) still apply.

## Alternatives considered

- **Keep merging upstream.** This gets runtime fixes for free, but keeps every
  inherited surface alive and turns each upstream release into a large
  conflict resolution.
- **Selective hard fork** (keep runtime and plugin core merge-compatible,
  diverge elsewhere). This was the roadmap's initial recommendation. It was
  rejected in favor of full freedom to restructure; the runtime watch list
  above keeps most of its benefit.

## Consequences

- Faster pruning and restructuring. Install size and maintenance load can drop.
- No upstream safety net when Codex, Claude Code or OpenCode change their CLI
  protocols. Every productized runtime needs its own recordings and a
  replay-before-upgrade check.
- Security fixes in shared dependencies and inherited code must be tracked
  independently.
- Resolved 2026-11-12: OpenPixo is published from its own repository,
  `OpenPixo/OpenPixo`, outside upstream's fork network. Open question not
  decided here: when to rename internal identifiers.

## Partial supersession — 2026-10-27

[ADR 0008](0008-cli-binary-pixo.md) supersedes the executable-name portion of
“Internal names may stay”: the CLI binary is now `pixo`, with no compatibility
alias. The historical decision above and its other internal identifiers remain
unchanged by this phase.

## Partial supersession — package names, 2026-10-27

[ADR 0009](0009-package-scope-openpixo.md) supersedes the package-name portion
of “Internal names may stay”: workspace packages now use `@openpixo/*` and the
root package is `openpixo`, without aliases or compatibility re-exports. The
historical decision above remains intact. Environment variables, persisted keys,
manifest formats and protocol names remain for their dedicated later phases.

## Partial supersession — runtime identifiers, 2026-10-27

[ADR 0010](0010-runtime-identifiers-pixo.md) supersedes retention of environment variables, headers, message/storage identifiers, card tags, manifest formats, project-directory names, OS protocols and persisted runtime identifiers. Both ends change together with no aliases, fallback readers or migration. The legacy data importer is deleted. The historical body above remains intact.
