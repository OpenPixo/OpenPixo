# agent-protocol

The daemon keeps Codex app-server subprocess support in `codex-app-server/`:

- `session.ts` owns the JSON-RPC session lifecycle and its bounded transport.
- `normalize.ts` maps Codex notifications into the shared run event contract.
- Thread cleanup and process ownership live beside those modules.

Claude Code and OpenCode use their stream helpers under `runtimes/`. ACP, Pi RPC and DeepSeek Harness profile adapters, and their unused shared JSON-line helper, have been removed.

Focused Codex protocol coverage lives in `tests/codex-app-server-*.test.ts`.
