# OpenPixo quickstart

Use Node 24, pnpm 10.33.2 and a supported local agent. The first-release native Codex baseline is 0.160.0. See [Windows setup](docs/windows-troubleshooting.md) and [the running guide](docs/RUNNING.md) for exact provider requirements.

1. Install workspace dependencies with `pnpm install --config.confirmModulesPurge=false`.
2. Start development with `pnpm tools-dev`; inspect `pnpm tools-dev --help` for lifecycle and namespace options.
3. Configure the installed CLI or provider credentials in Settings.
4. Open an existing game folder. Check the selected engine, assets and project extensions.
5. Start a conversation and review execution records and approval requests.
6. Use the lifecycle command for your own namespace to stop your development run.

Run `node apps/daemon/bin/pixo.mjs --help` to discover CLI equivalents, JSON output and prompt-file options. Importing a folder uses the selected external workspace. All daemon storage and isolation rules are in [AGENTS.md](AGENTS.md#daemon-data-directory-contract).

Windows builds are on the [download page](https://openpixo.com/download). Current acceptance (openpixo-internal: `docs/coordination/STATUS.md`) distinguishes local builds, replay fixtures, real model tasks and installed-instance evidence. Do not reuse a hands-on installed instance for tests.

[English overview](README.md) · [中文说明](README.zh-CN.md) · [contributing](CONTRIBUTING.md)
