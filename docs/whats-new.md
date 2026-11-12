# OpenPixo release highlights

The Home highlight is optional. Its daemon endpoint is `GET /api/whats-new`; the CLI mirror is `pixo whats-new [--json]`. Both read the same parsed document. There is no hosted source by default on any channel.

The checked-in docs/whats-new.json contains `{}` and intentionally shows no highlight. No publishing workflow or public release destination is configured. An explicit PIXO_WHATS_NEW_URL can select a fixture or an independently operated source. The source must use HTTPS, or HTTP on loopback, and cannot contain credentials. Without a valid source the daemon performs no fetch.

## Document contract

A complete document has nonempty id, title and body. Optional imageUrl and linkUrl use HTTPS. Optional ctaLabel supplies button text, and locales may override title, body, linkUrl and ctaLabel. Exact locale overrides win before base-language and base-document values.

The client remembers content identity, not just app version. Change id to present a new highlight. An empty or malformed document produces no card. Missing public release destinations remain placeholders and must never be opened.

Validate with `pnpm guard` and focused tests in apps/daemon/tests/whats-new.test.ts and apps/web/tests/components/WhatsNewPopup.test.tsx. Configure explicit fixture sources in an isolated runtime; follow the root [data directory contract](../AGENTS.md#daemon-data-directory-contract).
