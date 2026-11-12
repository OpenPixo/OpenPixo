# apps/packaged

Thin packaged Electron runtime entry for OpenPixo.

This package starts the packaged daemon and web sidecars, registers the `openpixo://`
entry protocol, and then delegates to `@openpixo/desktop/main` for the host
window. Product logic stays in `apps/daemon`, `apps/web`, and `apps/desktop`.
