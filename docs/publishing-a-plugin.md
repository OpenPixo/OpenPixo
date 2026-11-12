# Publishing an OpenPixo plugin

A plugin remains a portable SKILL.md bundle with an optional pixo.json manifest. OpenPixo can publish a local plugin to the author’s own GitHub repository. There is no configured public product repository or built-in community-catalog submission flow.

## Prepare a local plugin

```bash
pixo plugin scaffold --id game-tools --title "Game tools" --out ./plugins/community
pixo plugin validate ./plugins/community/game-tools --no-daemon
pixo plugin pack ./plugins/community/game-tools
```

Scaffold IDs are lowercase and use letters, digits, dots, underscores or hyphens; catalog vendor/name addressing is separate. Include a license and preserve any third-party attribution. Inspect `pixo plugin scaffold --help` and `pixo plugin pack --help` for exact output options.

## Publish to your own repository

```bash
pixo plugin login
pixo plugin whoami --json
pixo plugin publish-repo ./plugins/community/game-tools --help
```

The publish-repo command creates or updates the author-selected GitHub repository. Review its options, repository and visibility before publication. The UI publish-github action calls the same project plugin endpoint. GitHub authentication uses gh; do not put tokens in manifests or project files.

Portable bundles may also use the supported third-party catalog targets listed by `pixo plugin publish --help`. No product-owned community target or version-yank issue launcher is present. A custom catalog operator manages entries in their own repository or HTTPS manifest.

## Install and inspect

```bash
pixo plugin install --source ./plugins/community/game-tools
pixo plugin list --json
pixo plugin info game-tools --json
pixo marketplace list --json
```

Installation records source, trust, resolved content and integrity. Configure remote catalogs explicitly; bundled official entries are repository-local and the community snapshot is empty. See [the plugin spec](plugins-spec.md), [custom registry hosting](self-hosting-a-registry.md) and [plugin instructions](../plugins/AGENTS.md).
