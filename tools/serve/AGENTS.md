# tools/serve

Follow the root `AGENTS.md` and `tools/AGENTS.md` first.

This tool owns the `tools-serve` CLI and deterministic local updater and
release-storage fixture services. Keep services self-contained. Product update
runtime logic belongs to the packaged runtime, not these fixtures. New services
use explicit subcommands under `tools-serve start <service>`.
