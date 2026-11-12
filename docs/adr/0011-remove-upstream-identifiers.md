# ADR 0011: Remove inherited product identifiers

Date: 2026-10-28. Status: accepted by the repository owner's explicit instruction.

Supersedes ADR 0006's permission to keep internal names. ADR 0008, ADR 0009 and
ADR 0010 remain the executable, package and runtime decisions within this migration.
ADR 0005's independent identity, licensing and no-upstream-feed requirements remain binding.

The Library-token naming entry below records the migration checkpoint only. [Slim-core Batch 9](../coordination/SLIM-CORE.md#batch-9--game-copy) removes that token family with the unused global Library; run-token identity remains in force.

## Context

OpenPixo is a full hard fork, with no users and no released builds to migrate.
Keeping the previous names would create unnecessary ambiguity in agent commands,
packages, persisted state, generated content and maintenance instructions.
The installed Alpha.3 is a local review instance, not a compatibility requirement.

The source plan is [remove-upstream-traces.md](../../specs/current/remove-upstream-traces.md).
Its original wording and naming table remain migration evidence. Phase reports
record the actual deletions, validation and deliberately retained catalog content.

## Decision

Use the following names consistently, changing producers and consumers together:

| Previous name | OpenPixo name |
|---|---|
| CLI executable `od` | `pixo` |
| Package scope `@open-design/*` | `@openpixo/*` |
| Root package `open-design` | `openpixo` |
| Environment variables `OD_*` and the long `OPEN_DESIGN` family | `PIXO_*` |
| Code constants `OD_FOO` | `PIXO_FOO` |
| Identifiers `odFoo` / `OdFoo` | `pixoFoo` / `PixoFoo` |
| CSS classes `od-*` and custom properties `--od-*` | `pixo-*` / `--pixo-*` |
| HTTP headers `x-od-*` | `x-pixo-*` |
| Message, event and storage prefixes `od:` | `pixo:` |
| Artifact tag `<od-card>` | `<pixo-card>` |
| Plugin manifest `open-design.json` | `pixo.json` |
| Manifest metadata field `od` | `pixo` |
| Native plugin export target `od` | `pixo` |
| Project directory `.od/` | `.pixo/` |
| OS and packaged renderer protocol `od://` | `openpixo://` |
| Owned filenames `od-*` / `*open-design*` | `pixo-*` / `*openpixo*` |
| Product text OpenDesign / Open Design | OpenPixo |

Use the new names directly. There are no aliases, compatibility exports,
fallback readers, schema migrations or old-data import paths. The legacy data
importer was deleted. Data-root ownership still follows the root AGENTS.md
**Daemon data directory contract**; the rename creates no new path convention.

The closing sweep also removes residual owned names missed by earlier phases:
library/run token prefixes `odlt_` / `odtt_` become `pixolt_` / `pixott_`;
analytics and streaming keys use `pixo_`; full product-name values such as
`stored_in_open_design`, `start_open_design` and `open_design` use
`stored_in_openpixo`, `start_openpixo` and `openpixo`. Local manifest variables
use `pixo`. These are direct replacements, not dual readers.

## Removed surfaces and documentation

- Phase 1 removed the retired design strategy, design-system/brand resource
  domain, stock search, cloud/AMR runtime and media provider, team collaboration,
  billing/wallet/plans, cloud publication and their exclusive routes, contracts,
  UI, CLI, tests and content. Earlier removal commits also retired Orbit,
  Web Clipper, pets, deployment artifacts and exclusive inherited content.
  Slim-core batch 4 completed the catalogue decision: game resources and core
  dependencies remain; inherited families and their filter are deleted. See
  [the retained inventory](../coordination/PHASE1-CATALOG-REVIEW.md).
- Later phases removed upstream contribution and community-submission actions,
  repository sharing/promotion, star/release/Discord metadata, support-group
  links, inherited publication targets and implicit remote service defaults.
  Publishing to the author's own GitHub repository and sharing a user's
  deployed project URL remain supported.
- Upstream-only deployment, governance, announcement, release-note, cloud and
  retired-domain documentation was deleted. Only maintained English/Chinese
  onboarding and contributing material remains. Historical audits and handoffs
  with useful evidence live under `docs/coordination/`, explicitly marked as
  historical rather than presented as current feature inventories.
- The closing sweep deletes unreferenced collaboration/child-evidence fixtures,
  dead cloud mocks and the cloud-only account-suspension test. Generic ACP tests
  use retained runtimes. Retained external CLI recordings are unchanged.

See [phase 1](../coordination/PHASE1-REMOVAL.md),
[phase 5](../coordination/PHASE5-IDENTIFIERS.md) and
[phase 6](../coordination/PHASE6-TEXT.md) for exact scope and evidence.

## Required retained material

Keep LICENSE and NOTICE unchanged, including Apache-2.0 attribution and the
pinned upstream lineage. Preserve bundled third-party licenses/copyright and
imported author/source attribution, including the HyperFrames templates from
`nexu-io/html-video`. These identify separate imported components; they are not
OpenPixo service defaults or aliases.

Keep `docs/references.md` provenance, the root AGENTS.md fork-provenance line,
historical ADR bodies (0005–0010), migration-source specifications, historical
coordination/handoff records and Git history. Historical ADR updates are append-only.
Keep verbatim external CLI recordings, retained event projections and mocks data;
do not spend provider credits re-recording them or rewrite external output to
make a naming search empty. Sanitized artifact derivatives are identified as
derivatives and carry their own reviewed hashes.

ADR 0005 also requires retaining the upstream-host rejection policy. One pure
contracts module, `packages/contracts/src/upstream-policy.ts`, owns it for all
six feed/release/site consumers. Feed hosts reject `open-design.ai`, `nexu.space`
and subdomains, ignoring case and accepting the existing trailing-dot shape.
Release origins additionally reject any hostname containing `nexu`; site host
configuration preserves its broader substring rejection. Site links reject
decoded text containing `opendesign`, `open-design` or `nexu`. These checks and
their focused tests are deliberate naming exceptions, not upstream integrations.

## Regression policy

The regression check belongs in `scripts/guard.ts`. Enumerate tracked files
with `git ls-files`, scan text in process, and check tracked path names without
depending on ripgrep. Fail with file, line, matched pattern and a correction.
Cover the old brand/scope, underscore names, organization, environment/wire
prefixes, headers, card tag, manifest, protocol, quoted event prefix, project
directory, CSS hooks and owned path names. Bound ambiguous patterns so words
such as “odd”, “Odin” and “Nexus”, natural-language translations, hashes and
encoded assets do not become product-name violations.

Keep reviewed exceptions in one allowlist, with a reason for every exact path
or glob. Permit only the retained legal/provenance/history, migration evidence,
recording and imported-attribution classes above. Scope mixed files such as
root AGENTS.md to the actual provenance line. Outside those classes, list the
shared upstream policy and its unit/integration tests individually; never exempt
an entire source/test directory. This ADR's mapping table is migration evidence.
Any new exception needs the same explicit review and a reason. New product code
must use the new names; a compatibility need cannot silently expand the allowlist.

## Consequences

New builds cannot read the installed Alpha.3 instance's configuration, data or
old protocol. This is expected, and no migration is provided. Leave that review
instance and its OS registration untouched; any later uninstall is the owner's
decision. Validate source and packaging in independent task namespaces.

New content, fixtures and documentation use OpenPixo names. Legal lineage and
external protocol evidence remain inspectable. The final sweep is a classified
inventory, not a requirement to erase attribution or history.
