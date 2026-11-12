# `otd-operations-brief` · live-artifact template

> Retired, unregistered asset: OpenPixo's live-artifact domain and skill were
> removed in [ADR 0012](../../../docs/adr/0012-slim-core.md). This folder remains
> a static visual reference. The binding and fixture notes below describe the
> former renderer, not a supported daemon refresh or creation workflow.

> Category: **Live Artifacts**
> Family: operations / supply-chain / on-time-delivery / vendor performance
> Style: **Mono Crimson Operations Brief** (warm-white canvas · charcoal bars · single-accent crimson tick · tabular figures)

A historical `html_template_v1` template for an editorial On-Time Delivery brief. This folder contains:

- a tokenized HTML template (`template.html`) wired entirely with OpenPixo's scalar-only `{{data.X}}` bindings;
- a default sample `data.json` covering a 14-account month-over-month OTD slice plus a "lowest 8" deep-dive;
- `artifact.json` and `provenance.json` fixtures used by the former daemon domain;
- a pre-rendered `index.html` and `preview.png` so reviewers can see the artifact without spinning up a daemon.

## Files

```
templates/live-artifacts/otd-operations-brief/
├── README.md           ← this file
├── DESIGN.md           ← the Mono Crimson Operations Brief design spec (9-section schema)
├── template.html       ← html_template_v1 template (scalar {{data.X}} bindings only)
├── data.json           ← default sample data the template binds against
├── artifact.json       ← live-artifact stored snapshot (mirrors the spec fixture format)
├── provenance.json     ← provenance fixture noting that the figures are illustrative
├── index.html          ← pre-rendered preview = template.html × data.json (default display sample)
└── preview.png         ← 4:3 thumbnail of index.html for picker / gallery surfaces
```

`index.html` is the checked-in static preview formerly derived from
`template.html` + `data.json`. There is no current daemon renderer or refresh
endpoint for this format.

## How it binds

The former `html_template_v1` renderer was intentionally narrow:

- only `{{data.path.to.value}}` interpolation, paths must start with `data`;
- bindings must resolve to scalars (no array or object values);
- there is no repeat / loop / conditional directive — the template is **fully unrolled** for KPI 0..3, bar 0..13, and lowest-row 0..7;
- the renderer rejects `<script>`, `<iframe>`, `srcdoc=`, event-handler attributes, `javascript:` URLs, and `data-pixo-html|raw|bind-html` directives.

Refresh callers writing into `data.json` should preserve the same shape and cardinality (`kpis[4]`, `byKeyAccount.rows[14]`, `lowestAccounts.rows[8]`) so the unrolled template keeps rendering cleanly. Pre-compute every value the template binds — bar widths, prior-year ticks, formatted strings, and CSS class names — because the renderer cannot evaluate expressions.

## Historical visual use cases

The template illustrated these report shapes:

- monthly / weekly OTD or fill-rate brief;
- supplier-performance or carrier-performance scorecard;
- finance / procurement variance brief with prior-year comparison;
- audit-style operations summary where the readability bar is "looks like a printed report".

The Mono Crimson Operations Brief style enforces a single chromatic accent (crimson) reserved for negatives, prior-year ticks, and "lowest" call-outs. See `DESIGN.md` for the full token grammar.

## When **not** to use this template

- consumer marketing dashboards or product analytics surfaces — too austere, no headroom for hero imagery or branded gradients;
- multi-tenant home pages — designed for a single subject (one month, one currency, one division);
- mobile-first layouts — the template is sized for a 1200 px desktop reading surface and does not collapse below ~960 px.

## Static review

Open `index.html` to inspect the recorded example, or review `template.html`,
`data.json` and `DESIGN.md` as source material. This folder is not registered in
the game resource catalogue and has no live-artifact CLI or skill on-ramp.

## Source attribution

Original visual reference: a 1200 × 960 OTD operations dashboard image extracted into `DESIGN.md` via the openpixo 9-section spec. Sample account names, month, currency, and percentages are fictional and intentionally illustrative; do not treat them as ground truth.
