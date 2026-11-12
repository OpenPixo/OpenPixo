# Self-hosting An OpenPixo Registry

An OpenPixo registry is a source of `openpixo-marketplace.json` plus the
review process that produces it. In v1 this can be a static GitHub repository,
GitHub Enterprise, S3/R2, or any HTTPS host.

## Static Catalog Shape

```text
plugins/registry/
  official/openpixo-marketplace.json
  community/openpixo-marketplace.json
plugins/community/<vendor>/<plugin-name>/
  SKILL.md
  pixo.json
```

The machine-readable URL is the raw JSON file:

```bash
pixo marketplace add https://example.com/openpixo-marketplace.json --trust restricted
pixo marketplace refresh <id>
pixo marketplace search "deck" --json
```

Do not add a GitHub tree page. The daemon validates the response as JSON and
rejects HTML.

## Private GitHub Or GitHub Enterprise

```bash
pixo marketplace login https://github.example.com/org/plugin-registry
pixo marketplace add https://raw.github.example.com/org/plugin-registry/main/openpixo-marketplace.json --trust trusted
```

Authentication is delegated to `gh auth login --hostname <host>`. Tokens stay
inside GitHub CLI.

## Doctor

```bash
pixo marketplace doctor <id> --strict --json
```

Doctor checks stable `vendor/plugin-name` IDs, source/archive presence,
archive integrity, yanking reasons, dist-tag consistency, publisher identity,
license, and capability summaries.

## Database Backend Path

The runtime code talks to `RegistryBackend`. A static JSON registry, GitHub PR
registry, and database registry expose the same list/search/resolve/publish/yank
contract. A commercial deployment can replace the static backend with a managed
database for:

- private catalogs
- organization allowlists
- approval workflows
- SSO-backed publisher identity
- audit logs
- entitlements and paid distribution

The CLI vocabulary stays the same: `pixo marketplace add/search/doctor`,
`pixo plugin install/upgrade/publish-repo`.
