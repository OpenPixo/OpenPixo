# OpenPixo Plugins

Language: English | [简体中文](README.zh-CN.md)

This directory has two different jobs:

- `_official/` - first-party plugins bundled with OpenPixo. The daemon scans this tree at startup and registers these plugins as official.
- `community/` - community plugin source folders. These are installable plugins, but they are not preinstalled unless a registry entry points at them and the user installs one.
- `registry/` - default registry source manifests (`openpixo-marketplace.json`) for official and community catalogs. These feed the Plugins Available/Sources UI.
- `spec/` - the portable plugin specification, templates, examples, and agent handoff kit for building, testing, or publishing to their own repository.

A runnable plugin is a portable agent skill folder with a `SKILL.md`, plus an optional versioned `pixo.json` sidecar that gives OpenPixo marketplace metadata, inputs, previews, pipelines, and trust/capability hints. Art style presets are data-only bundles: their `pixo.json` declares `pixo.kind: "style"` and a `pixo.style` payload without a `SKILL.md`. Bundled styles and preview-image guidance live in [`_official/styles/README.md`](_official/styles/README.md).

Start here:

- Plugin spec kit: [`spec/README.md`](spec/README.md)
- Plugin authoring spec: [`spec/SPEC.md`](spec/SPEC.md)
- Agent handoff guide: [`spec/AGENT-DEVELOPMENT.md`](spec/AGENT-DEVELOPMENT.md)
- Registry publishing strategy: [`spec/PUBLISHING-REGISTRIES.md`](spec/PUBLISHING-REGISTRIES.md)
- Full product spec: [`../docs/plugins-spec.md`](../docs/plugins-spec.md)
- Manifest schema: [`../docs/schemas/openpixo.plugin.v1.json`](../docs/schemas/openpixo.plugin.v1.json)
- Marketplace schema: [`../docs/schemas/openpixo.marketplace.v1.json`](../docs/schemas/openpixo.marketplace.v1.json)
