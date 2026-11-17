# Usage events

OpenPixo's opt-in usage data goes to OpenPixo's own Cloudflare Worker. There is
no third-party analytics service: posthog-js and posthog-node were removed in
November 2026. The Worker, its storage and its setup live in the private cloud
repository (`docs/usage-events.md` there).

## What is sent

- Nothing until the user clicks 分享 in the consent banner or turns on usage
  data in Settings → Privacy (`telemetry.metrics === true`). Crash and stability
  reports wait for the same yes.
- Nothing from a build without `PIXO_USAGE_EVENTS_URL`. Release builds get it
  from tools-pack (`PIXO_USAGE_EVENTS_URL` at packaging time, an https origin
  such as `https://events.openpixo.com`). The upstream `POSTHOG_*` variables are
  ignored everywhere.
- Only counts. Every event passes `normalizeUsageEvent` in
  `packages/contracts/src/analytics/usage-events.ts`: a property survives only
  as a boolean, a finite number, or an identifier-shaped string (letters,
  digits, `.`, `_`, `:` and `-`, at most 64 characters) or a short list of
  them. Prompts, titles, genres, messages, stacks, log tails, paths and URLs
  are dropped. The Worker applies the same rule again on receipt.

## Who sends

| Sender | Path |
|---|---|
| Daemon (run events, the game funnel, media results) | `AnalyticsService` → `usage-events-client.ts` → `POST <ingest>/v1/events` |
| Web app (product events, error type counts, stability metrics) | `analytics/usage-client.ts` and `error-tracking.ts` → daemon `POST /api/analytics/events` → the daemon's client |
| Packaged launcher (startup failures, launch timing, daemon exits) | `startup-telemetry.ts` → `POST <ingest>/v1/events` directly, after reading consent from the daemon's app config |

The browser never talks to the ingest Worker and never receives its address.
The web app has no autocapture, page views, session replay or person profiles.

## The game funnel

`apps/daemon/src/game/game-funnel.ts` records `game_created`,
`game_plan_approved`, `game_verified`, `recipe_run_settled` and
`recipe_candidates_adopted`. A request from `pixo` (the user's or an agent's)
is counted under the installation id the user's yes created; without that id
nothing is sent.

## Adding an event

Send it through the existing path for its process. Do not add free-text
properties: they are dropped, and a property that only means something as text
does not belong in usage data. A dimension whose value contains a slash (such as
`capture_source: 'daemon/analytics'`) is dropped for the same reason paths are.
