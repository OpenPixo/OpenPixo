# ADR 0012: Retain a slim game-development core

Date: 2026-10-29. Status: accepted by the repository owner's explicit instruction.

Supersedes ADR 0007's protection of inherited runtime and design surfaces.
ADR 0006's hard-fork policy and ADRs 0008–0011's naming decisions remain binding.

## Context

The inherited design-tool surface dominated the web and daemon code. OpenPixo
needs a local agent workbench with an OpenCode-like project/session experience
and a game-development line, rather than maintaining unrelated inherited domains.
The owner chose deletion now; a later requirement can justify reintroducing the
minimum needed code. Hidden gates and unused compatibility layers add no value.

## Decision

Remove the following domains and their exclusive UI, routes, CLI, contracts,
translations, tests, fixtures and documentation:

| Batch | Removed |
| --- | --- |
| 1a | Memory, automations and routines. |
| 1b | Connectors, critique, live artifacts, GenUI, deploy, browser sessions, handoff CLI and upstream observability exporters. |
| 2 | Design browsing/editors, preview commenting and editing/slide/palette/tweaks bridges, deck templates, craft/design domains and inherited Home scenarios. |
| 3 | Legacy design prompt composition and annotation-history attachments. Every project uses the shared game composer. |
| 4 | Bundled catalogue families unrelated to games or required core resources, their previews/seeds and the inherited-family filter. |
| 5 | The 17 unsupported UI locales and their exclusive content, aliases, RTL rules and picker entries. |
| 6 | Every agent runtime adapter except Codex, Claude Code and OpenCode, including exclusive ACP/Pi/DSH infrastructure and replay wrappers. |

Codex, Claude Code and OpenCode are the three certified runtime families. They
cover the supported CLI protocols, native sessions and tool/approval behavior
without maintaining a large adapter matrix. OpenCode also supplies the bundled
and BYOK routes, including DeepSeek/OpenRouter-style providers. Provider/model
and media integration names do not imply another agent runtime. Keep their
recordings, mocks and protocol tests; live provider validation stays opt-in.

Keep projects and conversation history, chat streaming/tool calls/execution
records, Plan, approvals, stop/steer, question forms, file browsing/viewing/diff
and external editor/engine handoff. Keep game templates, engine verification,
assets, media generation, recipes/Studio, project skills/MCP, Store/registry,
settings and the desktop/packaged shells and tooling. Every physical Run still
starts through the analytics-bearing internal run-creation service.

Ship only game-relevant catalogue entries and dependencies used by recipes,
Studio, the Store's bundled snapshot, the game prompt or asset tools. Keep
import/enable/update/remove infrastructure for user extensions. The retained
inventory is in [the catalogue review](../coordination/PHASE1-CATALOG-REVIEW.md).
The maintained web UI locales are English and Simplified Chinese, both complete;
manifest translations, user content and provider language inputs remain separate.

## Consequences

- Saved configuration naming a deleted agent falls back to an available kept
  runtime or the normal no-agent state. Reading configuration does not rewrite
  its saved agent ID/model or delete the user's file.
- Remove creation code for deleted database tables. Leave old tables and columns
  in existing databases untouched; do not ship destructive cleanup migrations.
- Preserve the [Daemon data directory contract](../../AGENTS.md#daemon-data-directory-contract).
  Slimming the product introduces no new data paths or path inference rules.
- Keep a minimal shared piece when a retained feature depends on it; use neutral
  names and record the reason. Do not restore dead switches or extend inherited
  surfaces as the starting point for new OpenPixo features.
- Historical ADRs and coordination records remain evidence, not current feature
  inventories. Current guides and directory maps describe the retained core.

Committed scope and validation are recorded in [SLIM-CORE.md](../coordination/SLIM-CORE.md).
Final builds and an isolated mock-runtime smoke remain a separate acceptance step.
