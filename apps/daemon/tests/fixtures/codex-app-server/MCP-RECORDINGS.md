# Native MCP startup recordings

Recorded on Windows with the installed npm `codex-cli 0.160.0`, 2026-10-25
(Asia/Tokyo). These JSONL frames are the native output, including native thread
IDs and timestamps; no credentials or user-server configuration were recorded.

- `mcp-startup-0.160.0.jsonl`: an isolated disposable Codex home, one explicitly
  configured nonexistent fixture executable. Native `thread/start` and
  `mcpServerStatus/list` produced `starting` then `failed` with Windows error 2.
- `mcp-ready-0.160.0.jsonl`: the same isolated protocol probe using the reviewed
  repository fixture `e2e/resources/openpixo-mcp.ts` and the pinned Node 24
  executable. Native initialization produced `starting` then `ready`.

Neither recording sent `turn/start`, invoked a model, read user Codex
configuration, or started arbitrary user MCP servers. `ready` proves this
fixture completed native MCP startup; it does not prove a tool task, HTTP
authentication, or arbitrary third-party compatibility.

The additional RPC config-consumption probe is documented in
`docs/coordination/MCP-FEEDBACK.md`. Its resume check uses the native
in-memory-history resume path, since a new empty thread has no disk rollout.
