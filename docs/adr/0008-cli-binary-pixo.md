# ADR 0008: Rename the CLI binary to pixo

Status: Accepted — 2026-10-27

## Context

OpenPixo is a full hard fork of OpenDesign (ADR 0006). That decision allowed
internal names, including the `od` binary, to remain until a dedicated migration.
The repository owner has confirmed phase 2 of the naming cleanup: rename the
executable now, before there are users or released builds to migrate.

The inherited executable also collides with `/usr/bin/od`, the octal-dump tool
on macOS and Linux. The shorter candidate `op` conflicts with 1Password's CLI.

## Decision

- The executable is **`pixo`**. The old `od` executable and package-bin entry
  are removed, with no alias, compatibility wrapper, or transition period.
- `PRODUCT_CLI_NAME = 'pixo'` in `packages/contracts/src/product.ts` is the
  TypeScript source for CLI names in help, MCP defaults, prompts, and UI copy.
  Package manifests and Markdown examples spell the executable explicitly.
- Both package-bin maps point at `apps/daemon/bin/pixo.mjs` (relative to their
  respective packages). Reinstall dependencies to refresh local bin links.
- Source-checkout MCP installation continues to use absolute Node/CLI paths.
  It does not require a globally installed executable.

This supersedes only ADR 0006's permission to retain the old executable name.
ADR 0007 remains the separate skipped-domain decoupling decision.

## Deliberately retained identifiers

Phase 2 changes the command name only. These remain for later phases:

- `OD_*` environment variables, including `OD_BIN`, `OD_NODE_BIN`, and
  `OD_DAEMON_CLI_PATH`. Agent instructions using those absolute paths continue
  to work without depending on the executable's PATH name.
- Plugin manifest `od` fields and export target `'od'`. They describe data
  formats, not a shell command. Package names were subsequently renamed by
  [ADR 0009](0009-package-scope-openpixo.md).
- `.od/` directories, `x-od-*` headers, persisted keys, CSS identifiers,
  sidecar protocol names, `od:` message prefixes, and the `od://` OS protocol.
- Archived upstream documents `docs/spec.md` and `docs/roadmap.md`, the
  historical body of ADR 0006, and Git history. LICENSE and NOTICE stay intact.

## Consequences

Users and agents invoke `pixo media`, `pixo project`, and the other existing
subcommands. `pnpm exec pixo --help` resolves the workspace binary; `pnpm exec od`
must not resolve an OpenPixo binary. A host's unrelated octal-dump utility is
outside this repository's executable contract.

HTTP endpoints, CLI flags, JSON output, environment variables, manifest formats,
and persisted state retain their existing contracts. There is no data migration.
