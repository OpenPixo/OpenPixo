export const PRODUCT_NAME = "OpenPixo";

export const INTERNAL_PACKAGES = [
  { directory: "packages/release", name: "@openpixo/release" },
  { directory: "packages/components", name: "@openpixo/components" },
  { directory: "packages/contracts", name: "@openpixo/contracts" },
  { directory: "packages/registry-protocol", name: "@openpixo/registry-protocol" },
  { directory: "packages/sidecar-proto", name: "@openpixo/sidecar-proto" },
  { directory: "packages/launcher-proto", name: "@openpixo/launcher-proto" },
  { directory: "packages/platform", name: "@openpixo/platform" },
  { directory: "packages/sidecar", name: "@openpixo/sidecar" },
  { directory: "packages/download", name: "@openpixo/download" },
  { directory: "packages/host", name: "@openpixo/host" },
  { directory: "packages/agui-adapter", name: "@openpixo/agui-adapter" },
  { directory: "packages/plugin-runtime", name: "@openpixo/plugin-runtime" },
  { directory: "packages/diagnostics", name: "@openpixo/diagnostics" },
  { directory: "apps/daemon", name: "@openpixo/daemon" },
  { directory: "apps/web", name: "@openpixo/web" },
  { directory: "apps/desktop", name: "@openpixo/desktop" },
  { directory: "apps/packaged", name: "@openpixo/packaged" },
] as const;

export const DESKTOP_LOG_ECHO_ENV = "PIXO_DESKTOP_LOG_ECHO";
export const WEB_STANDALONE_HOOK_CONFIG_ENV = "PIXO_TOOLS_PACK_WEB_STANDALONE_HOOK_CONFIG";
export const WEB_STANDALONE_RESOURCE_NAME = "openpixo-web-standalone";
export const ELECTRON_BUILDER_ASAR = false;
export const ELECTRON_BUILDER_BUILD_DEPENDENCIES_FROM_SOURCE = false;
export const ELECTRON_REBUILD_MODE = "sequential" as const;
export const ELECTRON_REBUILD_NATIVE_MODULES = ["better-sqlite3"] as const;
export const ELECTRON_BUILDER_FILE_PATTERNS = [
  "**/*",
  "!**/node_modules/.bin",
  "!**/node_modules/electron{,/**/*}",
  // Dependency tarballs can carry dotenv credentials; never ship them.
  "!**/.env",
  "!**/.env.*",
  "!**/*.map",
  "!**/*.tsbuildinfo",
  "!**/.next/cache",
  "!**/.next/cache/**",
  "!**/node_modules/better-sqlite3/build/Release/obj",
  "!**/node_modules/better-sqlite3/build/Release/obj/**",
  "!**/node_modules/better-sqlite3/deps",
  "!**/node_modules/better-sqlite3/deps/**",
] as const;
// Keep Electron native UI resources aligned with the Web UI locale set.
// Electron uses underscore-separated locale ids; its base "es" resource
// covers the app's es-ES dictionary.
export const MAC_ELECTRON_LANGUAGES = [
  "en",
  "de",
  "zh_CN",
  "zh_TW",
  "pt_BR",
  "es",
  "ru",
  "fa",
  "ar",
  "ja",
  "ko",
  "pl",
  "hu",
  "fr",
  "uk",
  "tr",
] as const;
