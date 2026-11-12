# OpenPixo network defaults

> Historical isolation checkpoint. Vela/AMR, collaboration and their opt-in
> flags described below were subsequently removed; they are not current
> operating switches. Current retained boundaries follow
> [ADR 0012](../adr/0012-slim-core.md).

Updated 2026-10-25 (Asia/Tokyo), based on OpenDesign commit `9724c441`.

## Implemented

- Daemon `app-config.ts` and browser `state/config.ts` default metrics/content sharing off. Hydration creates a reporting ID only after explicit metrics opt-in and never implicitly enables content sharing. Saved explicit choices remain intact.
- Vela telemetry requires `PIXO_VELA_TELEMETRY` set to `1`, `true`, `on`, or `yes`; an existing AMR login alone no longer selects a telemetry sink. Explicit relay/Langfuse/PostHog configuration remains supported.
- Highlights have no hosted feed by default on any channel. Only explicit `PIXO_WHATS_NEW_URL` enables them. The compatibility export `DEFAULT_WHATS_NEW_URL` is null.
- Upstream GitHub/release/Discord metadata is disabled before fetch. Disabled HTTP endpoints return 204; the retained service has an explicit constructor opt-in.
- `routes/vela.ts` requires `OPENPIXO_UPSTREAM_CLOUD_ENABLED=1` before creating services or reading credentials. Defaults report signed out and an empty model catalogue; Vela/touchpoint actions return 503 `upstream_cloud_disabled`.
- Retained daemon Cloud fixtures explicitly opt in. New isolation tests pass empty environments. The e2e harness keeps the shipped default.

## Validation

- Network and existing-login telemetry regressions observed red before fixing them.
- Cloud isolation, network defaults, highlights: 21/21 pass. Disabled Cloud routes never call app-config or credential-observation services; opt-in reaches the original implementation.
- Browser config: 73/73 pass.
- Changed daemon config/consent/highlight subset: 59 pass, 61 unrelated cases excluded.
- Vela telemetry resolver: 5 pass, 106 unrelated cases excluded.
- Full affected daemon config/highlight/network files: 119/120 pass. The remaining `projectLocations` fixture expects POSIX slashes on Windows; reproduced independently against untouched upstream source. Production path behavior unchanged.
- Retained opt-in touchpoint authorization fixture: 39/40 pass. The directory-fsync fault-injection case also fails on the untouched upstream Windows snapshot; the default-disabled Cloud path never reaches this integration.

## Boundaries

Parent owns guard/typecheck, desktop smoke, and packaging. No full suites or live provider calls run here. Packaging separately handles updater and telemetry environment isolation. Product shell owns visible branding/privacy/campaigns. `routes/collab-context.ts` independently resolves workspace directories through Vela and must be included in the parent's default local-startup smoke. No workspace authorization was relaxed.
