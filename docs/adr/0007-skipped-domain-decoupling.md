# ADR 0007: Decouple inherited domains from the local game product

Date: 2026-10-26. Updated: 2026-10-27. Status: accepted and implemented.

Superseded in part by [ADR 0012](0012-slim-core.md): runtime protection, remaining design surfaces and catalogue policy.

The retained-Library statements below are also superseded by [slim-core Batch 9](../coordination/SLIM-CORE.md#batch-9--game-copy); the global registry, API and CLI are removed while project assets remain independent.

Catalogue follow-up (2026-10-28): slim-core batch 4 supersedes the undecided
catalogue/filter statements below. The inherited families and filter are deleted;
the retained game/core inventory is in [the completed review](../coordination/PHASE1-CATALOG-REVIEW.md).

## Decision

The [decoupling task](../../specs/current/decouple-skipped-domains.md) authorizes removal of OD Next, design systems/brands, and Vela/collaboration/billing. Extract shared behavior into local single-user modules first. Removed schemas, config keys, headers and persisted fields disappear directly; there are no users and no migration or compatibility layer is required.

The user explicitly permits deleting the AMR adapter as an exception to ADR 0006's runtime-adapter protection. That exception covers AMR and its cloud branches only. The generic runtime engine, other adapters, protocol infrastructure, sidecar/platform packages, plugin core, media pipeline, Library and packaging control planes remain protected.

OD Next and the design-system/brand resource domain have been removed. Skill discovery is local in `services/skill-catalog.ts`. Production route and tool authorization uses `projects/project-access.ts`: a safe project ID, an existing local record, and storage inside the managed project root or the selected imported folder. Managed directory redirects cannot escape their root. Existing token and origin middleware stays authoritative; sandbox file-operation checks remain at their existing boundary so unavailable imported folders still have readable metadata.

## Round-two decision

On 2026-10-27 the repository owner explicitly retired stock search, including its APIs, CLI, contracts, telemetry and grants, and confirmed removal across the whole repository. The prior stopping condition and authorization question are resolved. Vela cloud, the AMR adapter, team collaboration, billing/wallet/plans, cloud publication, message center and workspace-team identity are removed from runtime code, UI, CLI, contracts, shell integration and dedicated tests. Local project access, comments, deploy/export, social-link sharing, CLI/BYOK onboarding, plugins, recipes, Studio and game paths remain.

`PRODUCT_SURFACES` and its helper are deleted. The resource filter keeps the undecided catalog families hidden without a product-switch mechanism. The five specified retired-domain skills and their exclusive plugin/seeder entries are deleted; the other 507 catalog entries remain undecided. No phase 2+ naming or migration work was added.

The owner subsequently resolved the final packaging dependency: `tools/pack/src/opencode-runtime.ts` obtains bundled OpenCode from official `opencode-ai@1.18.35` and its target platform package. The Vela distribution and resolver are removed. See packaging evidence (openpixo-internal: `docs/coordination/PACKAGING.md`).

## Evidence

Commits, focused checks, required game/mock smokes, failures, per-category remaining-hit summary and replay comparison are recorded in [PHASE1-REMOVAL.md](../coordination/PHASE1-REMOVAL.md#round-two-completion-2026-10-27). The user-authorized selected web batch is broader than the original sweep. An exploratory daemon command accidentally selected the full suite through a duplicate config option and was stopped; it supplies no acceptance result. Remaining daemon checks use explicit file arguments. No live model/provider test was run. The installed Alpha.3 instance and upstream attribution were not changed. Historical replay hashes use an unavailable normalizer; a fresh before/after comparison proves identical event values (ignoring session IDs), shapes and order, with unchanged parser source.

## Archive location — 2026-10-28

The original decoupling task is now a [historical coordination record](../coordination/archive/decouple-skipped-domains.md). The decision and its original link above remain unchanged.
