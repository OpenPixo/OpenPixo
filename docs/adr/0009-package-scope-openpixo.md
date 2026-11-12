# ADR 0009: Rename the workspace package scope to @openpixo

Status: Accepted — 2026-10-27

## Context

OpenPixo is a full hard fork of OpenDesign (ADR 0006). The repository owner
confirmed phase 3 of the naming cleanup before any users or released builds
exist. The package identity can therefore change without a migration period.
The intentionally running local Alpha.3 review instance is historical evidence
and is outside this source/build validation.

## Decision

- Rename all 27 workspace packages from `@open-design/*` to `@openpixo/*`,
  preserving their package suffixes. Rename the root package to `openpixo`.
- Update dependency declarations, module specifiers, runtime package resolution,
  aliases, build filters, CI commands, packaging lists and terminal fixture
  assembly together. Refresh the lockfile through `pnpm install` and rebuild
  exported `dist` entries before runtime validation.
- Provide no aliases, compatibility re-exports or package-name fallback.
- Update repository command examples to the new names. Preserve LICENSE,
  NOTICE, provenance, ADR 0005/0006 historical bodies, upstream repository URLs
  and verbatim external CLI recordings. The cleanup plan's old-to-new naming
  table remains a record of the migration source.

This supersedes only ADR 0006's package-name retention and the package-name
reservation in ADR 0008. `OD_*`, the manifest `od` field/export target, `.od/`,
`x-od-*`, `od://`, `od:` prefixes, CSS identifiers and persisted keys remain
outside phase 3. Daemon data ownership continues to follow the root
`AGENTS.md` **Daemon data directory contract**.

## Consequences

Consumers and scripts must use the new package names. A source checkout must
reinstall dependencies and rebuild outputs; old generated JavaScript may still
contain unresolvable module specifiers. Package manifests, lockfile, package
source hashes, build-command determinants and the packaged after-pack hook
invalidate affected build-cache entries through their existing inputs; cache
key semantics and schemas do not change.

Retaining both scopes was rejected because it would create an unnecessary
compatibility surface before release. See the [phase 3 report](../coordination/PHASE3-SCOPE.md)
for commands, runtime and packaging evidence.
