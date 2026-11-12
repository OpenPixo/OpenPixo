# apps/packaged

Follow the root `AGENTS.md` and `apps/AGENTS.md` first. This app owns only the packaged Electron runtime assembly entry.

## Owns

- Packaged Electron entry glue.
- Packaged config loading.
- Runtime startup of daemon/web sidecars before desktop main.
- `openpixo://` packaged entry routing to the internal web runtime.

## Does not own

- Product/business logic.
- Web, daemon, or desktop implementation details.
- Sidecar protocol definitions or process stamp semantics.

## Rules

- Consume `@openpixo/sidecar-proto`, `@openpixo/sidecar`, and `@openpixo/platform` primitives; do not hand-build stamp flags or process matching logic.
- Keep data/log/runtime/cache paths namespace-scoped and independent from daemon/web ports.
- Keep Next.js packaged runtime as SSR/web-sidecar-owned; do not put Next output under `PIXO_RESOURCE_ROOT`.
- `PIXO_RESOURCE_ROOT` is for daemon non-Next read-only resources. Keep its bundled-tree contract aligned with the authoritative list in `tools/pack/src/resources/index.ts` instead of maintaining a shorter copy here.
