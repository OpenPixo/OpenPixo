# ADR 0005: Fork OpenDesign for the OpenPixo workbench

Date: 2026-10-25. Status: accepted by the user's explicit instruction;
partly superseded by [ADR 0006](0006-full-hard-fork.md) (full hard fork —
the "add only what the frozen first-release scope requires" limit no longer
applies; identity, licensing, telemetry and no-upstream-feed rules still do).

OpenPixo uses the Apache-2.0 OpenDesign repository, pinned initially to
`9724c44142ea0afaee3d207f37901b31c66a44ad`, as its implementation base.
The fork started as a personal GitHub fork and now lives at https://github.com/OpenPixo/OpenPixo.

Keep the upstream Electron shell, Next.js/React workbench, local TypeScript
daemon, projects/history, file viewers, providers, skills/MCP infrastructure
and build tools. Add only the game-project workflow and behavior required by
the frozen first-release scope. Native Codex remains the default local runtime.
The inherited provider interface describes its actual adapter and requirements.

This supersedes the electron-vite implementation detail in ADR 0004. Windows
first, local real project folders, language support, user-funded providers,
and the remaining product boundaries are unchanged. The original M0 source
and verification history are preserved in commit `c011cc4` as behavioral
reference; OpenPixo does not maintain two independent workbenches.

Preserve upstream attribution and per-component licenses. Use independent
application/installer identity, data namespaces and OS protocol. Do not update
OpenPixo from OpenDesign's feed. Telemetry and upstream public-service
integrations require deliberate configuration rather than inherited defaults.

Implementation ownership and current acceptance evidence live in
`openpixo-internal/docs/coordination/STATUS.md`; a successful upstream startup does not establish
completion of the OpenPixo feature or release gates.
