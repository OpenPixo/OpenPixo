# OpenPixo plugin and store contract

Plugins package portable skills, assets and MCP context for local game projects.
Each plugin has a portable `SKILL.md`; `pixo.json` adds versioned metadata,
inputs, provenance, previews and context references. Authoring starts in
[plugins/spec](../plugins/spec/README.md). The maintained schemas are
`packages/contracts/src/plugins/` and [the JSON schema](schemas/openpixo.plugin.v1.json).

## Install and project context

The store/registry resolves bundled, local and remote plugin sources. Installation,
update, removal and capability grants use the daemon's plugin APIs and the
`pixo plugin` / `pixo store` CLI surfaces. Project skill/MCP extensions use
`pixo extensions` and the project's Extensions panel; MCP configuration remains
available through `pixo mcp` and Settings.

Applying a plugin validates inputs and resolves its skills, assets and MCP
context into a persisted snapshot. Existing run history keeps that snapshot's
provenance. Plugin installation never starts a hidden agent. Physical runs go
through `internalRunCreation.start(run, analytics, starter)`.

## Runtime boundary

The agent uses the normal chat stream, tool calls, approvals and stop/steer
controls. Missing user information uses the host's `<question-form>` artifact.
Game media, asset operations and recipes keep their own HTTP/UI/CLI contracts.

The host pipeline executor, atom workers, GenUI surfaces, connector account
bindings, critique theater and live-artifact backend have been removed.
Historical pipeline metadata is still parsed for existing store bundles and
snapshots; it does not schedule host work or inject atom bodies into runs.
There are no connector/GenUI permission grants or APIs.

## Persistence and validation

Plugin state follows the root [daemon data-directory contract](../AGENTS.md#daemon-data-directory-contract).
Removing old domain creation code does not drop tables in existing databases.
Run `pnpm guard`, the package-scoped typechecks and focused install/snapshot,
registry and project-extension tests. See [SLIM-CORE](coordination/SLIM-CORE.md)
for this removal's exact validation evidence and retained boundaries.
