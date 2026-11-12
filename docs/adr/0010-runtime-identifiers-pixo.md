# ADR 0010: Use OpenPixo runtime identifiers

Status: Accepted — 2026-10-27

## Context

The repository owner confirmed phase 4 of the naming cleanup before users or
released builds exist. The remaining runtime and persisted identifiers can
change directly, with all producers and consumers changed together.

## Decision

- Environment variables use `PIXO_*`, including embedded `NEXT_PUBLIC_PIXO_*`
  names and the former long product-name environment family. The daemon,
  orchestrators, agents, CLI, web and content use the same names.
- HTTP headers use `x-pixo-*`. Messages, browser storage, DOM events and
  Electron IPC use the `pixo:` prefix. The card artifact tag is `<pixo-card>`.
- Plugin manifests are `pixo.json`, their metadata field is `pixo`, and their
  native export target is `pixo`. Skill and template frontmatter use `pixo`.
- The project-owned directory is `.pixo/`. This is a rename only; daemon data
  ownership continues to follow the root AGENTS.md Daemon data directory contract.
- The packaged renderer protocol and OS deeplink protocol use `openpixo://`.
  Registration, routing, installer declarations and identity checks agree.
- Remaining product-owned persisted and protocol names use pixo/openpixo,
  including sidecar wire names, config/storage keys and database identifiers.
  Source identifiers and CSS naming remain for phase 5.
- There are no old-name aliases, fallback readers, compatibility layers or data
  migrations. The legacy data-import feature and its packaged forwarding and
  special startup timeout are deleted.

This supersedes the runtime-identifier retention in ADR 0006 and the corresponding
reservations in ADR 0008/0009. Their historical bodies remain intact.

## Consequences

New builds cannot read the installed Alpha.3 instance's config, data or protocol.
This is expected; no migration is provided. Uninstalling Alpha.3 is the user's
decision. Source validation must use an isolated namespace and explicit data
root, and must not stop, uninstall, launch or change the installed instance.

ADR 0005 remains binding: application and installer identity, data namespaces
and OS protocol belong to OpenPixo; upstream feeds and telemetry have no inherited
defaults. LICENSE, NOTICE, upstream provenance and external CLI fields stay intact.

Per-item commits, searches and verification are recorded in
[the phase 4 report](../coordination/PHASE4-RUNTIME-IDS.md).

Runtime wire identities also include sidecar/launcher argv, private IPC endpoint
labels, host globals, browser partition and drag MIME identifiers, embedded data
attributes, task-boundary tags and observation/export schemas. Plugin schemas use
non-network OpenPixo URNs rather than claiming an undecided public domain.
The retained SQLite schema and app-config keys have no branded table/column/key
names to replace; the transaction sentinel changes directly. No branded cookies
or IndexedDB databases exist in the retained application. Existing schema evolution
for unrelated features is unchanged; no identifier migration is introduced.
