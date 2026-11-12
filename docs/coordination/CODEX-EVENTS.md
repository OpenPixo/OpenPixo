# Codex events and Windows native resolution

Updated 2026-10-25. Owner: runtime_core/codex_events.

Implemented on the OpenDesign fork:

- `apps/daemon/src/agent-protocol/codex-app-server/normalize.ts` maps `subAgentActivity` and `collabAgentToolCall` onto existing `Task` tool rows. Child thread IDs and parent IDs remain attached to every row; status comes from the child state, not completion of the spawn/wait tool. Activity and collaboration feeds deduplicate. Interacting again after child completion creates a new task row rather than trying to revive a settled row.
- The normalizer's optional fourth `rootThreadId` getter filters child text, reasoning, usage and turn errors out of the parent stream, while retaining child lifecycle summaries. Session code must supply `() => threadId` and independently reject a child's `turn/completed` as the root turn's completion.
- `apps/daemon/src/runtimes/launch.ts` now recognizes modern npm `vendor/<target>/bin/codex.exe` layouts, including nested optional packages, hoisted optional packages and the legacy main `@openai/codex` package. Existing `.cmd` wrapper fallback remains available for hermetic fixtures and supported wrapper launch paths.

Verification: eight new regressions failed before the fixes. Final focused run passed 63 tests across child events, native layouts, existing normalization, transport parity and launch suites; five POSIX-only tests skipped on Windows. No paid model calls or process lifecycle changes. Vitest required elevation because the filesystem sandbox rejects Node `realpath` even on workspace source files.

Remaining integration: session root getter and terminal gate are owned by runtime_core. Full daemon typecheck and actual desktop/model smoke are coordinated by the root agent. These focused tests prove protocol normalization and path selection, not a real model execution or sandbox calibration.
