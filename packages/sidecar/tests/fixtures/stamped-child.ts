import { writeFileSync } from "node:fs";

const capturePath = process.env.PIXO_TEST_SIDECAR_ENV_CAPTURE;
if (capturePath != null) {
  writeFileSync(capturePath, JSON.stringify({
    argv: process.argv,
    endpoint: process.env.PIXO_SIDECAR_CLIENT_ENDPOINT ?? null,
    resources: process.env.PIXO_SIDECAR_RESOURCES ?? null,
  }));
}

process.on("SIGTERM", () => {
  // The convergence test deliberately exercises the exact-stamp force fallback.
});

setInterval(() => undefined, 60_000);
