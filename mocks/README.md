# `mocks/` — replay-based mock CLIs

A PATH-overlay harness for OpenPixo's three supported agent CLI protocols:
**Claude Code, Codex and OpenCode**. It replays anonymized recordings without
calling a provider. BYOK OpenCode and bundled OpenCode use the OpenCode protocol.
`opencode-cli` is an alias of the `opencode` mock.

## Quick start

```bash
# Fetch the supported-runtime corpus; later runs use the verified local cache.
bash mocks/scripts/fetch-recordings.sh
export PATH="$PWD/mocks/bin:$PATH"
export PIXO_MOCKS_TRACE=04097377
export PIXO_MOCKS_NO_DELAY=1

echo "test prompt" | claude -p --output-format=stream-json
echo "test prompt" | codex exec
echo "test prompt" | opencode run
```

The wrappers execute `node mocks/mock-agent.mjs --as <agent>`. On Windows,
Node can invoke that entry directly with `--as claude`, `--as codex` or
`--as opencode`; the shell wrappers are Bash launchers.

Input is discarded by the renderer and used only for prompt-hash selection.
`--report-file <path>` (or `REPORT_FILE`) projects the final assistant report
into a file for the caller.

## Recording selection

| Environment variable | Behavior |
|---|---|
| `PIXO_MOCKS_TRACE=<id>` | Fixed trace; an eight-character prefix is accepted. |
| `PIXO_MOCKS_BY_PROMPT_HASH=1` | Deterministically select from the prompt hash. |
| `PIXO_MOCKS_POOL=<tag>` | Select from `agent:claude`, `skill:agent-browser`, `outcome:failed`, or another recorded tag. |
| `PIXO_MOCKS_SEED=<str>` | Reproducible random selection. |
| `PIXO_MOCKS_NO_DELAY=1` | Skip inter-event waits. |
| `PIXO_MOCKS_RECORDINGS_DIR=<path>` | Read recordings from an explicit directory. |

Selection follows the table order: fixed trace, prompt hash, pool, then random.
An explicit trace or pool that matches nothing fails instead of selecting an
unrelated recording. The chosen trace is printed to stderr.

## Corpus and provenance

`manifest.json` contains **136 recordings**: Claude Code 57, Codex 38,
OpenCode 41. Outcomes are 109 succeeded and 27 failed. Raw recordings are
ignored cache files fetched on demand from the inherited archive specified in
the manifest. `pnpm install` does not fetch them.

```bash
bash mocks/scripts/fetch-recordings.sh --agent claude
bash mocks/scripts/fetch-recordings.sh --outcome failed
bash mocks/scripts/fetch-recordings.sh --skill agent-browser
PIXO_MOCKS_CACHE_DIR=/path/to/cache bash mocks/scripts/fetch-recordings.sh
```

The manifest is the recording inventory. Each entry stores its trace id,
SHA-256, byte count, agent, outcome, skill tags, session metadata and capture
provenance. Missing CLI/protocol/anonymization version metadata remains null.
The fetcher verifies every download against its SHA-256. The original uploader
was removed; future capture/storage work needs an explicitly selected
independent destination.

These are protocol fixtures. Their recorded task text and skill tags describe
historical sessions and do not expand OpenPixo's supported product catalogue.
Paths and project identities were anonymized; tool payloads remain recorded
verbatim. The retained recording identities, payload hashes and golden event
snapshots are unchanged by the slim-core runtime removal.

## Protocols and tests

| Mock | Daemon protocol | Parser |
|---|---|---|
| `claude` | `claude-stream-json` | `runtimes/claude-stream.ts` |
| `codex` | `json-event-stream` (`codex`) | `runtimes/json-event-stream.ts` |
| `opencode`, `opencode-cli` | `json-event-stream` (`opencode`) | `runtimes/json-event-stream.ts` |

```bash
bash mocks/scripts/smoke-test.sh
pnpm --filter @openpixo/daemon test -- tests/mocks-golden.test.ts
```

`golden/` holds one representative daemon-event projection for each protocol.
See [golden/README.md](golden/README.md) for intentional snapshot updates.
Tests skip the corpus-dependent cases when recordings have not been fetched;
they do not silently substitute another session.

`mocks/scripts/contract-check.sh` compares an authenticated real CLI with its
mock. It makes a live provider call, so run it only when explicitly requested;
see [the contract-check guide](../docs/MOCKS-CONTRACT-CHECK.md).

## Files

- `mock-agent.mjs`: common selection, stdin handling and renderer dispatch.
- `bin/{claude,codex,opencode,opencode-cli}`: Bash PATH-overlay launchers.
- `lib/recording-picker.mjs`: deterministic trace and pool selection.
- `lib/format-{claude,codex,opencode}.mjs`: native protocol renderers.
- `manifest.json`: supported-runtime recording inventory and checksums.
- `golden/`: three daemon-event snapshots and their rationale.
- `scripts/`: fetch, offline smoke, explicit live contract check and manifest math.
- `recordings/`: ignored on-demand recording cache.

No external runtime dependencies are required. Model and permission CLI flags
are accepted for invocation compatibility but do not change the replay.
