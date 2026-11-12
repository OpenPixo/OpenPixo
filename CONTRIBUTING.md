# Contributing to OpenPixo

[English](CONTRIBUTING.md) · [简体中文](docs/i18n/CONTRIBUTING.zh-CN.md)

Read [AGENTS.md](AGENTS.md) first, then the AGENTS.md for each layer you touch. Report bugs and propose features in [GitHub issues](https://github.com/OpenPixo/OpenPixo/issues); for a non-trivial feature, open an issue and agree on the problem with the maintainers before you start. Report security problems privately as described in [SECURITY.md](.github/SECURITY.md).

## Environment

Use Node 24 and pnpm 10.33.2. This Windows checkout has a pinned local toolchain; use the PATH setup in [AGENTS.md](AGENTS.md#windows) without changing global installations. Native dependencies may compile through node-gyp and require Visual Studio Build Tools.

```powershell
pnpm install --config.confirmModulesPurge=false
pnpm tools-dev --help
```

Use `pnpm tools-dev` for local lifecycle and an isolated namespace for tests. Namespace selection alone does not isolate daemon data. Follow [the data directory contract](AGENTS.md#daemon-data-directory-contract), which is the sole authority for daemon storage. Never stop or reuse an installed hands-on instance for validation.

## Changes and validation

- Keep app logic behind daemon HTTP APIs and pure shared DTOs in contracts. User-facing capabilities need both UI and CLI surfaces.
- Prefer TypeScript. Keep tests in package-level sibling test directories and Playwright flows under e2e/ui.
- Use focused tests for affected behavior and integration boundaries. Do not run the full daemon or web suites locally unless a maintainer asks for them.
- Run `pnpm guard` and `pnpm typecheck` before publication. Build consumed package outputs after source changes.
- Reproduce bug fixes with a meaningful red test, then confirm the correction. Keep mock/provider-free evidence separate from live model acceptance.
- New dependencies need a concrete use case and exact versions under repository policy. Keep local data, screenshots and generated scratch output out of git unless they are intended review artifacts.

## Review

Use Conventional Commit titles and the complete [PR template](.github/pull_request_template.md). Explain the user problem, observable result, affected UI/CLI/API/content surfaces and verification. Attach screenshots of changed UI entry points. Follow [the review guide](docs/code-review-guidelines.md). Do not add co-author metadata to commits.

Bundled skills, templates and plugins must preserve third-party licenses and author attribution. For functional skills read [skills/AGENTS.md](skills/AGENTS.md); for rendering content read [design-templates/AGENTS.md](design-templates/AGENTS.md); for plugins read [plugins/AGENTS.md](plugins/AGENTS.md). There is no automated upstream contribution or community-submission flow. Own-repository publishing is documented in [the plugin guide](docs/publishing-a-plugin.md).
