# Public links and live rooms

Status: building (2026-11-04). Two separate tools the AI and the creator can use:

- `pixo publish`: put a web game on a public link. Anyone with the link can play. No gallery.
- `pixo rooms`: add live rooms to a game so friends on the link can play together.

`pixo leaderboard` is the next tool and is out of scope here. The inherited `pixo share` (social share text for a URL) is unrelated and stays.

Shared DTOs and the room wire protocol: `packages/contracts/src/api/publish.ts`.

## Decisions

| Topic | Decision |
| --- | --- |
| Public means | Anyone with the link. No browsing, listing, comments or profiles. |
| Games | Web games only (Phaser, Three.js, other Vite/static builds). Godot, Unity and UE get a clear refusal. |
| Authority | One player hosts. The server only relays messages. Not for ranked or prize play. |
| Room size | 8 players (config). |
| Price | 10 free player-hours per creator per calendar month (UTC), then 5 credits per player-hour from the creator's wallet. Players never sign in or pay. |
| Spending limit | Per game, per month. Default 500 credits, creator can change it. When reached, new rooms stop opening and open rooms close at the next settlement. |
| Chat | No chat API in the SDK. Player identity is a server-assigned id (`p1`, `p2`, ...), no display names. |
| Launch state | `publish_paused` and `rooms_paused` default **true**, like every other switch. The owner opens them. |

All numbers live in a config row, never in code.

## Architecture

```
Creator's app (daemon)
  1. JWT   -> Supabase publish-begin    (rules, quota, creates the share row)
  2. token -> Worker PUT files          (direct to R2 through the Worker)
  3. JWT   -> Supabase publish-finish   -> Worker activates the version -> returns the link

Player's browser
  https://<domain>/<shareId>            wrapper page: game iframe + Report button
  https://<domain>/<shareId>/<code>     same page, joining that room (hands the game ?room=<code>)
  https://<shareId>.<domain>/...        the game, from R2
  POST /__rooms, wss /__rooms/<code>    Worker -> Room Durable Object

Room Durable Object -> Supabase rooms-admit / rooms-settle   (open, every 10 min, close; never per message)
```

**Playing a game must not touch Supabase.** Only publishing, reports, room admission and settlement do. Supabase is on the Free plan and pauses when idle; if it is unreachable, existing games keep loading and open rooms keep running, with settlement retried. Only opening a new room fails.

### Domain and isolation

- The games domain is a separate domain from `openpixo.com`, set by the `PLAY_DOMAIN` Worker var. The owner buys it before going live; until then everything runs in local Workers (`wrangler dev`) with `http://<shareId>.localhost:<port>` and `http://localhost:<port>/<shareId>`.
- Each game gets its own subdomain, so one game cannot read another's saves.
- Direct top-level navigation to a game subdomain redirects to the wrapper, so a game cannot appear full-page without the Report button (check `Sec-Fetch-Dest: document`).
- Game responses carry a strict CSP: `default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; connect-src 'self' ws://<game host> wss://<game host> blob: data:; form-action 'none'; base-uri 'self'; frame-ancestors <wrapper origin>`, plus `X-Content-Type-Options: nosniff`.
- The wrapper iframe uses `sandbox="allow-scripts allow-same-origin allow-pointer-lock"` and `allow="fullscreen; gamepad; autoplay; clipboard-write"`. No forms, popups or top navigation.

### Upload rules (enforced server-side; the daemon's checks are only for faster errors)

- Extension allowlist: html, js, mjs, css, json, map, wasm, png, jpg, jpeg, gif, webp, svg, avif, ico, mp3, ogg, wav, m4a, opus, webm, mp4, ttf, otf, woff, woff2, txt, xml, csv, atlas, fnt, tmx, tsx (data), tmj, tsj, ldtk, bin, glb, gltf, ktx2, hdr. Everything else is refused, with the path named.
- Root `index.html` required.
- HTML containing a password input is refused.
- Path rules: relative, no `..`, no leading dot segments, length-limited, no backslashes.
- Plans (table in the cloud, keyed by SKU; owner 2026-11-07): no subscription cannot publish or update, Starter 10 live games and 100 MB per game, Pro 30 and 200 MB, Max 50 and 500 MB. A link never goes offline because of the plan: a lapsed or over-limit account keeps its links and can remove them.
- Config caps for everyone: 50 MB per file, 2,000 files, 30 publishes per account per day.
- Upload tokens are HMAC-signed by Supabase with `PLAY_INTERNAL_SECRET`, expire after 15 minutes and are bound to share id and version. The Worker refuses paths not in the prepared manifest and checks size and SHA-256.

### Reports and takedown

- The wrapper's Report button posts a reason (fixed list plus optional details, capped at 1,000 characters), rate-limited per IP.
- `node scripts/share-takedown.ts <shareId> --reason <text>` marks the game removed. The Worker reads `live.json` before serving any file, cached for at most 60 seconds, so a takedown lands within a minute everywhere.
- Plays are counted by a wrapper beacon in a per-game counter. Crossing the soft cap (config, 50,000 a month) flags the game `under_review` for the operator while it keeps playing. Crossing the hard cap (config, 500,000 a month) stops serving until the operator clears it. A forged beacon can only cause a review.

## Room behaviour

- `POST /__rooms` creates a room with a 6-character code (unambiguous alphabet) after `rooms-admit` approves it. The game id comes from the subdomain, never from the client.
- `GET /__rooms/<code>` upgrades to a WebSocket handled by the Durable Object **Hibernation API**. Full rooms and unknown codes are refused with a clear reason.
- First joiner is host. If the host leaves, the room closes with reason `host-left`, unless the room was created with `hostMigration: true`; then the earliest remaining player becomes host.
- Limits: 16 KB per message, 60 messages per second per player. Excess is dropped with a warning; sustained excess closes that socket.
- Idle rooms (no message from anyone for 10 minutes) close. Rooms close at 4 hours regardless. Both are config. An empty room closes after 60 seconds, so a refreshing host can return only if `hostMigration` is on.

### Metering and settlement

- The room records cumulative player-seconds in its own storage. Join and leave times live in socket attachments so hibernation loses nothing.
- `rooms-settle` receives the room's **cumulative** total. The database applies only the increase, so a retry can never charge twice.
- Settlement runs at close and every 10 minutes via a Durable Object alarm. If the cloud is unreachable, the alarm retries and the final settlement is kept until it succeeds.
- Database rule: per account per month, free minutes are used first. Credits owed are `floor(billable_minutes * credits_per_hour / 60)` minus credits already charged that month, so fractions are never lost or rounded in the operator's or creator's disfavour across settlements.
- A debit never takes the wallet below zero. If the wallet or the game's limit runs out, the charge stops at what was available and the response says `continue: false`; the room sends `closing` with reason `out-of-credits` or `limit-reached` and closes.
- Earned-revenue offset, ads and rewarded rooms are out of scope.

## Local testing without the cloud

Creators and agents must be able to test two players with no account, no credits and no deployment. The daemon runs a local relay speaking the same protocol, using POST plus Server-Sent Events (no new dependency). The SDK picks its backend:

1. `?pixoRooms=<url>` in the page URL: local relay. `pixo rooms test` prints two such URLs for the running game.
2. Otherwise hosted, same origin, at `/__rooms`.
3. On a loopback page with no relay given, the SDK's error tells the creator to run `pixo rooms test`.

The relay accepts only loopback origins and is never billed.

## Surfaces

| Capability | HTTP (daemon) | CLI | UI |
| --- | --- | --- | --- |
| Publish or update | `POST /api/projects/:id/publish` then poll `GET .../publish` | `pixo publish [--project] [--title] [--accept-terms] [--no-build] [--json]` | Share button in the game toolbar |
| Status | `GET /api/projects/:id/publish` | `pixo publish status` | Share dialog |
| Remove | `DELETE /api/projects/:id/publish` | `pixo publish remove` | Share dialog |
| Add the SDK | `POST /api/projects/:id/rooms/install` | `pixo rooms add` | Share dialog's "Ask the AI to add multiplayer", because the SDK is useless until the AI also writes the lobby and game code |
| Usage and limit | `GET` and `PATCH /api/projects/:id/rooms` | `pixo rooms status`, `pixo rooms limit <credits>` | Share dialog |
| Two-player test | `POST /api/projects/:id/rooms/test` | `pixo rooms test` | Share dialog |

The first publish on an account needs explicit acceptance of the sharing rules (`acceptTerms`, `--accept-terms` or the dialog's checkbox). The AI only publishes when the creator asks; the skill says so.

## Cloud HTTP contract (daemon to cloud)

Supabase functions use the signed-in user's JWT and the existing `{ error: { code, message } }` shape. Types are from `api/publish.ts`.

| Call | Request | Response |
| --- | --- | --- |
| `POST publish-begin` | `{ shareId?, title, acceptTerms?, files: [{ path, size, sha256 }] }` | `{ shareId, version, uploadBaseUrl, uploadToken, url }` |
| `PUT {uploadBaseUrl}/{version}/{encoded path}` | Raw file bytes, `Authorization: Bearer <uploadToken>` | `204` |
| `POST publish-finish` | `{ shareId, version }` | `{ game: PublishedGame }` |
| `GET share-status?shareId=` (shareId optional) | | `{ game: PublishedGame \| null, usage: RoomsUsage \| null, paused: { publish, rooms }, termsAccepted, termsUrl, limits: { maxPlayers, creditsPerPlayerHour } }` |
| `POST share-remove` | `{ shareId }` | `{ ok: true }` |
| `POST share-limit` | `{ shareId, monthlyCreditLimit }` | `{ usage: RoomsUsage }` |

Error codes: `PUBLISH_PAUSED` (503), `PUBLISH_REFUSED` (422, with `error.refusedFiles: string[]` up to 20 paths), `PUBLISH_QUOTA` (429), `PUBLISH_PLAN_REQUIRED` (402), `SHARE_TERMS_REQUIRED` (409), `SHARE_NOT_FOUND` (404), plus the existing `ACCOUNT_*` and `CLOUD_UNAVAILABLE`.

The daemon stores `shareId` in the project's metadata. Sending no `shareId` creates a new link; sending one updates that link and keeps its URL.

## Owner steps before this is live

Nothing here happens automatically: buy the games domain, enable the paid Workers plan, deploy the Worker, set `PLAY_INTERNAL_SECRET` on both sides, apply the migration, publish the sharing rules page, then open `publish_paused` and `rooms_paused`.
