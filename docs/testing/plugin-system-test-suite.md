# Plugin/store validation

The maintained boundary is local skill/MCP extension management, plugin installation,
registry/store resolution, input/context application and persisted provenance snapshots.
The authoritative app contracts live in `packages/contracts/src/plugins/`.

Use `pnpm guard` and package-scoped typechecks. Focused daemon coverage includes
`tests/plugins-apply.test.ts`, `tests/plugins-snapshots.test.ts`,
`tests/services/project-extensions.test.ts` and registry/store route tests.
The web project-extension panel and plugin detail tests cover their UI consumers.
Do not run full daemon/web suites for routine local validation; follow root AGENTS.md.

The pipeline executor, GenUI, connector and critique suites were retired with their
implementations. Static manifest parsing remains for bundled and historical snapshots.
See [the plugin contract](../plugins-spec.md) and [SLIM-CORE](../coordination/SLIM-CORE.md).
