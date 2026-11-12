# Website data export

The OpenPixo website (openpixo.com) lives in its own private repository,
`OpenPixo/openpixo-site`: every page, word, price, image and the page generator.
This repository keeps only what the website reads from the app:

- `site export` writes one data file with the release notes (`CHANGELOG.md`),
  the official recipes (`plugins/_official/recipes/*/pixo.json`) and the bundled
  Store snapshot (`plugins/registry/official/openpixo-marketplace.json`).
- `openpixo site-manifest` promotes a published Stable release into the
  website's download manifest (see `openpixo-internal/docs/coordination/PACKAGING.md`).

From this repository's root, with the website checked out next to it:

```powershell
pnpm --filter @openpixo/tools-release dev site export --out ../openpixo-site/data/app.json
```

Then run `npm run generate` in the website repository, review the diff and
commit it there. The export validates the Store snapshot with the same rules the
website applies, drops empty fields, and lists recipes only. Which recipes and
Store items the website shows is the website's decision, not this export's.
