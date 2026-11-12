# OpenPixo project extensions delivery

Updated 2026-10-25 (Asia/Tokyo). Product source frozen after immutable catalog snapshot review correction.

## Implemented slice

- Project workspace Extensions panel (`ProjectExtensionsPanel.tsx`) provides English/Chinese copy, existing shared buttons, catalog selection, local/GitHub import, template guidance, enable/disable, explicit update, and removal. Game-assets owner mounts the panel in the existing workspace tabs.
- Daemon reuses the existing skills scanner/manifest parser, bounded remote installer and SSRF-safe fetcher, MCP schema/templates, executable resolver, and project authorization. No separate plugin execution platform or new dependency.
- Project manifests and installed snapshots derive exclusively from the resolved daemon data root. See root [AGENTS.md](../../AGENTS.md), **Daemon data directory contract**, for the storage authority contract.
- Adding a catalog skill copies its complete folder and side files into a project-owned immutable snapshot. Adding a configured catalog MCP captures its config. A SHA-256 package/config fingerprint identifies the actual selected version. Changing the original source/global MCP configuration does not change execution until explicit Update.
- Local/GitHub skill imports retain all side files, validate identity, reject links/traversal and unsupported file types, and enforce 50 MiB / 10,000-entry / depth limits. Public GitHub trees/archives reuse upstream parsing and archive protections.
- MCP imports accept one server JSON object or a standard `mcpServers` JSON map from an explicitly selected local file or a public GitHub JSON file. Import only stores configuration; it does not execute an external extension.
- Selected MCP configurations and enabled skill bodies/directories are returned by `resolveProjectExtensions` to the native Codex runtime integration owned by runtime_core. Empty or disabled project extensions add no run inputs. Global user skill/MCP/Codex configuration remains untouched.
- Workspace-bound project catalogs retain their authorized partition. Runtime resolution fails closed if an enabled snapshot is missing. Interim legacy catalog entries without snapshots appear unavailable until explicitly updated.
- Updating is explicit; failed downloads/invalid changed identities leave the working manifest intact. In-flight tasks retain their captured old skill paths. Removal unregisters the project entry and preserves original imports, generated game files, and already-captured immutable cache packages.

## HTTP contract

All routes use the existing local-daemon gate. Reads and writes pass project authorization; writes also require local same-origin checks.

- `GET /api/projects/:id/extensions` returns installed skills/MCP summaries and reusable catalogs/templates.
- `POST /api/projects/:id/extensions` imports and enables an entry for that project.
- `POST /api/projects/:id/extensions/:kind/:extensionId` accepts `{ "action": "enable" | "disable" | "update" }`.
- `DELETE /api/projects/:id/extensions/:kind/:extensionId` unregisters only that project entry.
- Mutations return the refreshed, persisted listing. Summary responses omit MCP environment/header secret values and internal cache paths.

Catalog skill:

```json
{ "kind": "skill", "catalogId": "game-assets-batch" }
```

Local skill folder:

```json
{ "kind": "skill", "source": "C:\\Games\\Example\\.agents\\skills\\asset-helper" }
```

Public GitHub skill:

```json
{ "kind": "skill", "source": "https://github.com/owner/repository/tree/main/skills/asset-helper" }
```

MCP server config:

```json
{
  "kind": "mcp",
  "server": {
    "id": "asset-tools",
    "transport": "stdio",
    "command": "node",
    "args": ["C:\\Tools\\asset-mcp.mjs"],
    "enabled": true
  }
}
```

Use `{ "kind": "mcp", "source": "<absolute local JSON file or public GitHub JSON file URL>" }` for a configuration source that supports explicit refresh. Use `catalogId` to snapshot an existing configured global MCP without modifying it.

## CLI

New `pixo extensions` entry delegates to a focused HTTP client module. It accepts `--json`, `--daemon-url`, and `PIXO_PROJECT_ID` as the project fallback. Long MCP JSON can be passed through a file or stdin rather than shell quoting.

```text
pixo extensions list --project <id> --json
pixo extensions add --project <id> --kind skill --catalog game-assets-batch
pixo extensions add --project <id> --kind skill --source <absolute-folder-or-GitHub-URL>
pixo extensions add --project <id> --kind mcp --config-file <JSON-file-or-dash-for-stdin>
pixo extensions disable mcp asset-tools --project <id>
pixo extensions update skill asset-helper --project <id>
pixo extensions remove skill asset-helper --project <id>
```

## Verification evidence

- Focused daemon suites: **45/45 passed**, covering project service (9), route authorization/persistence/redaction (3), CLI request boundaries (3), and existing installer safety suite (30).
- Web panel focused tests: **6/6 passed**, including project-switch isolation, persisted mutation state, retained failed-import inputs, required template configuration, safe homepage links, and catalog Update/version response.
- Final daemon source + test typecheck: **passed**, after rebuilding contracts and registry protocol dependencies.
- Web typecheck: **passed** after shared contract rebuild (reported by UI agent).
- Security test fixture now directly encodes a hostile tar symbolic-link header. It still verifies installer rejection and runs on native Windows without administrator symlink privileges.
- Cross-layer imported-game/native-run acceptance is owned by acceptance_qa and runtime_core; consult their reports for actual Codex transport, tool calls, approvals, and app evidence. Do not promote the unit tests to proof that arbitrary third-party MCP servers connected successfully.

## Deliberate limits

- Dependency feedback distinguishes missing required fields / missing executable from configured-but-not-connected. It never claims that finding `npx` proves its package/server is installed or authenticated. The native Codex task stream now maps `mcpServer/startupStatus/updated` into visible per-session MCP feedback for starting, ready, failed, and cancelled states; tool-call outcomes remain separate. See [MCP feedback audit](MCP-FEEDBACK.md) for recorded native evidence and its limits.
- Legacy SSE is reported as unsupported for the native Codex path; use streamable HTTP or stdio. Per-project inline JSON has no external refresh source, so edit by removing and importing the revised config. Existing global settings retain their own OAuth management; project templates can use explicit headers/environment configuration.
- Remote imports support public GitHub/HTTPS archives only; no private GitHub account/token flow. Imports retain source and content hash rather than claiming a Git commit from an unpinned branch URL.
- Prior skill cache snapshots are retained for running-task safety; automatic cache pruning is intentionally deferred. Removal does not delete game outputs or source packages.
- Tests use fixture servers and source packages. No arbitrary external extensions or paid provider/model tasks were executed by this agent.
