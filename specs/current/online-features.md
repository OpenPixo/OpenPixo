# Online features and extra public games

Status: building (2026-11-09). Owner decisions from the 2026-11-09 multiplayer discussion. It sits
beside [publish-and-rooms.md](publish-and-rooms.md), which stays the source for links and live rooms.

Two changes:

1. **Extra public games for credits.** A subscriber whose plan's public games are all in use can
   publish one more game for a one-time credit charge instead of being refused.
2. **Online features** (`pixo online`): every published web game gets its own small backend for
   leaderboards, saves, async battles (a saved team fought by other players while its owner is
   away) and racing ghosts. Nobody needs to be online at the same time.

Both are a main revenue line, so the rule for every surface is: **the creator should never have to
set anything up or understand a backend**. The AI adds it, tests it locally with fake players, and
the same code works once the game is published.

## Decisions

| Topic | Decision |
| --- | --- |
| Extra game price | One-time `extra_game_credits` (config, default **100**) per extra game. Updating that game later is free. Removing it gives no refund; republishing a removed paid game is free. |
| Who can pay | Only a subscriber over their plan's game count. No subscription still means no publishing (2026-11-07 rule unchanged). Only the creator confirms: an agent token can never pay. |
| Online scope | Web games published on our link only. Godot, Unity and native builds are not covered (same as rooms). |
| Shape | One generic backend per game, not one feature per genre. Async battles and ghosts are recipes in the skill built from the same few operations. |
| Players | Anonymous. A server-issued player id and token kept in the game's own `localStorage` (each game has its own subdomain). Names are generated (`Brave Fox 42` / `勇敢的狐狸 42`); players never type a name. No free-text chat. |
| Trust | Casual only, like rooms. Scores players submit can be faked; ghosts make a fake visible and the Report button exists. Ratings change only through matches the server handed out. Not for prizes. |
| Billing | **Online features are never charged per use.** They are included in the subscription with per-account monthly caps by plan. Hitting a cap makes the creator's games read-only until next month or an upgrade. Everything is metered for statistics. Rooms keep their own credit billing unchanged. |
| Test vs live | The local emulator is the test area. There is no separate test copy of hosted data in this version. |
| Rooms | Not merged into the backend. The share dialog and the skill present rooms and online features together. |
| Launch state | `online_paused` defaults **true**. The owner opens it. |

All numbers live in config rows, never in code.

### Caps (defaults, per account per calendar month, UTC)

| Plan SKU | Requests | Stored data |
| --- | --- | --- |
| `plan_starter_monthly_v3` | 1,000,000 | 100 MB |
| `plan_pro_monthly` | 5,000,000 | 500 MB |
| `plan_studio_monthly` | 20,000,000 | 2 GB |

Per-object limits of the storage backend: 10 GB, about 1,000 requests a second, 30 days of
point-in-time recovery.

Per game, regardless of plan (config): 64 KB per document, 2 KB per inbox message, 20 collections,
50 keys per player per collection, 50 inbox messages kept per player (oldest dropped), 100 results
per query, 60 requests a minute per player, 20 new players an hour per IP, 200,000 requests an hour
per game (bounds overshoot between settlements).

## Extra public games

### Cloud

- `multiplayer_settings.extra_game_credits integer not null default 100`.
- `shared_games.extra_paid_at timestamptz` (null = counts against the plan).
- The plan count (`share_live_games`) counts only live games with `extra_paid_at is null`.
- `publish-begin` takes `payExtraGame?: boolean`. For a new link, or a removed or never-finished
  one without `extra_paid_at`, when the plan count is full:
  - without `payExtraGame`: refuse with `PUBLISH_EXTRA_GAME_REQUIRED` (402), `error.credits` = price,
    and a message an old app can show as is: "Your plan's 10 public games are in use. Update
    OpenPixo to publish more games for 100 credits each."
  - with it, and spendable credits below the price: the existing `INSUFFICIENT_CREDITS`.
  - with it and enough credits: mark the share `extra_pending` and go on.
- The charge happens when the version activates (`publish_pending` / finish), once, with the ledger
  idempotency key `extra-game:<shareId>`, and sets `extra_paid_at`. A failed upload charges nothing.
  Spendable credits are the same ones generation spends.
- `share-status` `publishPlan` gains `extraGameCredits` and `extraGames` (live games paid as extra),
  and each game reports `extraPaid`.

### App

- Contracts (`api/publish.ts`): `PublishRequest.payExtraGame?`, `PublishPlan.extraGameCredits?` and
  `extraGames?`, `PublishedGame.extraPaid?`, error code `PUBLISH_EXTRA_GAME_REQUIRED`.
- The daemon refuses `payExtraGame` from an agent token (403, a message telling the agent to ask the
  creator to confirm in the Share dialog). `pixo publish --pay-extra-game` for the creator.
- Share dialog: when the plan count is full, before the creator presses Publish, say so and offer
  **Publish for 100 credits** (one click, shows balance) and **Upgrade plan**. Too few credits offers
  **Buy credits**. The same panel appears if the cloud answers `PUBLISH_EXTRA_GAME_REQUIRED`.
  Copy: "Your Starter plan includes 10 public games and all are in use. Publish this one for 100
  credits, charged once; updates stay free."

## Online features

### SDK (`game-sdk/openpixo-online/openpixo-online.ts`)

Installed by `pixo online add`, kept up to date the same way as the rooms SDK (hash marker, never
edited). Backend choice, like rooms: `?pixoOnline=<url>` uses the local emulator; otherwise the
same origin at `/__online/v1`; on a loopback page with neither, the error says to run
`pixo online test`.

```ts
import { online, OnlineError } from './openpixo-online';

const me = await online.me();                                  // { id, name }
await online.put('ghosts', ghostRun, { key: 'track-1', score: 83.21 });
const best = await online.top('ghosts', { key: 'track-1', by: 'score', order: 'asc', limit: 10 });
const mine = await online.rank('ghosts', { key: 'track-1', by: 'score', order: 'asc' }); // { rank, total } | null
const doc = await online.get('ghosts', { player: best[0].player, key: 'track-1' });

await online.put('teams', myTeam);                             // key defaults to 'main'
const match = await online.pick('teams', { by: 'rating' });    // opponent near my rating, or null
const after = await online.recordMatch(match, 'win');          // { you, opponent } new ratings
await online.send(match.doc.player, { kind: 'attacked', won: false }); // their inbox
const news = await online.inbox();                             // newest first

await online.remove('teams');
await online.forgetMe();                                       // deletes this player and all their data
```

A document: `{ player, name, collection, key, data, score: number | null, rating, updatedAt }`.
`score` is what the game submits (lap time, points). `rating` starts at 1000 and changes only
through `recordMatch` (Elo, K 32, integers). `pick` returns `{ matchId, doc }`: a random document
from another player near the caller's own rating or score in that collection, preferring players not
picked recently. `recordMatch` needs a `matchId` this player got from `pick` in the last 30 minutes,
used once; it updates both ratings and returns them.

Every refusal throws `OnlineError` with `code` and a `message` written for players: `read-only`
(the creator's monthly allowance is used up or there is no plan), `paused`, `too-large`,
`too-fast`, `bad-request`, `not-found`, `match-expired`, `unavailable`. Reads keep working when
read-only. The SDK retries `unavailable` once.

Names: `[a-z0-9_-]{1,40}` for collections and keys. `data` is JSON, at most 64 KB serialized.

### Wire protocol (`packages/contracts/src/api/online.ts`)

`POST <base>/v1` with JSON `{ op, ...args }` and `Authorization: Bearer <player token>` (except
`register`). One endpoint so the local emulator and the hosted backend share one request union
(`OnlineRequest`) and one response union (`OnlineResponse` = `{ ok: true, ... } | { ok: false,
error: { code, message } }`). Ops: `register`, `me`, `put`, `get`, `top`, `rank`, `pick`,
`recordMatch`, `send`, `inbox`, `remove`, `forgetMe`. `ONLINE_PROTOCOL_VERSION = 1`.

### Storage schema (same SQL in the Durable Object and the local emulator)

```sql
create table players (id text primary key, token_hash text not null unique, name_seed integer not null,
  created_at integer not null, last_seen_at integer not null);
create table docs (collection text not null, player text not null, key text not null, data text not null,
  bytes integer not null, score real, rating integer not null default 1000, updated_at integer not null,
  primary key (collection, player, key));
create index docs_score on docs (collection, key, score);
create index docs_rating on docs (collection, key, rating);
create table inbox (id integer primary key autoincrement, player text not null, from_player text not null,
  data text not null, created_at integer not null);
create table matches (id text primary key, player text not null, collection text not null,
  opponent text not null, key text not null, created_at integer not null, used integer not null default 0);
create table meta (k text primary key, v text not null);  -- schema version, usage counters, state
```

Each copy migrates itself on wake from `meta.schema_version`. Changes must stay additive.

### Hosted (openpixo-cloud)

- A new SQLite Durable Object class `GameData`, one per share id (`idFromName(shareId)`), wrangler
  migration `v2`. The game id comes from the subdomain, never the client.
- `POST /__online/v1` on the game's subdomain routes to it. **Playing must not touch Supabase.**
- Metering: the object keeps this month's `requests`, `writes`, `bytes` (sum of document and inbox
  sizes) and `players`, and reports the **cumulative** month totals to Supabase `online-settle`
  (internal secret) from an alarm, at most every 10 minutes and only when something changed, plus
  1 minute after the first request of a game that never reported or was quiet for longer than a
  report interval. The schedule lives in stored meta, never instance memory: production evicts an
  idle object within seconds (fixed 2026-11-09 after it postponed a first report forever). The response gives the state the object enforces until
  the next report: `ok`, `read-only` or `paused`. With no report yet the object starts `ok`; if
  Supabase is unreachable it keeps the last state and retries.
- Supabase stores `online_usage(share_id, user_id, month, requests, writes, bytes, players)`
  applying only increases, and `online_plan_limits(sku, max_requests_month, max_storage_bytes)`.
  State is `paused` when `online_paused`, `read-only` when the account has no plan or its summed
  requests or stored bytes across its games reached the plan's cap, otherwise `ok`.
- Lifecycle, all in the object's alarm:
  - The game is removed (`/__internal/shares/<id>/state` removed): delete all its data 30 days later.
    Activating a version of it again cancels that.
  - No request for 90 days: report `idle` once (Supabase records `online_idle_at`; the creator sees
    it in the dialog, and an email goes out if the cloud has an email helper). With still no request
    by day 120, delete all data. Any request resets this.
  - A player not seen for 180 days is deleted with their documents and inbox (daily sweep).
  - Deleting everything uses `deleteAll()`; usage already reported stays in Supabase.
- Creator calls (JWT, creator only): `online-status?shareId=` → `OnlineUsage` (this game and the
  account this month, caps, state, players, documents per collection, idle notice), and
  `POST online-reset { shareId }` → the Worker's internal `/__internal/online/<id>/reset` → `deleteAll()`.

### Local emulator (daemon)

- Same protocol at a loopback-only route, persisted per project in SQLite under `RUNTIME_DATA_DIR`
  (see the daemon data directory contract in `AGENTS.md`). Never metered or billed, no caps except
  the per-document limits, so tests behave like hosted.
- `pixo online test` prints the running game's URL with `?pixoOnline=` (and `?pixoRooms=` when the
  rooms SDK is installed too), same rules as `pixo rooms test` for agent tokens.
- `pixo online seed [--players 20] [--collection teams] [--from <json file>]` adds fake players with
  generated names, copying a real document's shape when one exists, so one creator can test
  leaderboards, ghosts and matchmaking alone.

### Surfaces

| Capability | HTTP (daemon) | CLI | UI |
| --- | --- | --- | --- |
| Add the SDK | `POST /api/projects/:id/online/install` | `pixo online add` | Share dialog: "Ask the AI to add…" with three presets: leaderboard, racing ghosts, async battles |
| Status and usage | `GET /api/projects/:id/online` | `pixo online status` | Share dialog, Online section |
| Local test | `POST /api/projects/:id/online/test` | `pixo online test` | Share dialog |
| Fake players | `POST /api/projects/:id/online/seed` | `pixo online seed` | Share dialog: "Add 20 test players" |
| Browse local data | `GET /api/projects/:id/online/data` | `pixo online data [--collection]` | Share dialog: counts per collection |
| Reset local data | `DELETE /api/projects/:id/online/data` | `pixo online reset` | Share dialog |
| Clear hosted data | `DELETE /api/projects/:id/online/hosted` | `pixo online reset --hosted` | Share dialog, with confirmation; creator only |

All `--json`. An agent token may add, test, seed, browse and reset local data; clearing hosted data
is creator only.

### Skill

`skills/multiplayer-networking` gains an "Online features" section (choose online features for
leaderboards, saves, async battles and ghosts; rooms only when players must be in the same match at
the same time) and two worked references: `online-async-battle.md` (team saved with `put`, `pick`,
a deterministic auto-battle from two teams and a seed, `recordMatch`, an `inbox` notice, the
defender's replay) and `online-racing-ghosts.md` (positions and headings sampled about 10 times a
second, quantized and interpolated, about 20 KB a lap, best lap per track with `put` keyed by track,
`top` ascending, race a friend's or the leader's ghost). Testing: `pixo online seed` and
`pixo online test`, then `pixo game verify`.

## Owner steps before this is live

Apply the two migrations, deploy the Worker (new Durable Object class), deploy the new functions,
release an app version with the new dialog, then open `online_paused`. The extra-game charge works
as soon as the migration is applied; old apps show the cloud's message.
