import { build } from "esbuild";

await build({
  bundle: true,
  entryNames: "[dir]/[name]",
  entryPoints: [
    "./src/index.ts",
    "./src/api/connectionTest.ts",    "./src/api/providerModels.ts",
    "./src/api/reasoningExecution.ts",
    "./src/api/research.ts",
    "./src/runtime/deck-stage-fallback.ts",
    "./src/runtime/motion-source-player.ts",
    "./src/runtime/deck-protocol.ts",
    "./src/runtime/preview-observability.ts",
    "./src/runtime/preview-build-focus.ts",
    "./src/runtime/preview-runtime-state.ts",
    "./src/runtime/preview-guards.ts",
    "./src/runtime/html-injection-points.ts",
    "./src/analytics/index.ts",
  ],
  format: "esm",
  outbase: "./src",
  outdir: "./dist",
  outExtension: { ".js": ".mjs" },
  packages: "external",
  platform: "node",
  target: "node24",
});
