export const PRODUCT_NAME = "OpenPixo";
export const DESKTOP_LOG_ECHO_ENV = "PIXO_DESKTOP_LOG_ECHO";
export const WEB_STANDALONE_HOOK_CONFIG_ENV = "PIXO_TOOLS_PACK_WEB_STANDALONE_HOOK_CONFIG";
export const WEB_STANDALONE_RESOURCE_NAME = "openpixo-web-standalone";
export const ELECTRON_BUILDER_ASAR = false;
export const ELECTRON_BUILDER_BUILD_DEPENDENCIES_FROM_SOURCE = false;
export const ELECTRON_BUILDER_NODE_GYP_REBUILD = false;
export const ELECTRON_BUILDER_NPM_REBUILD = false;
export const ELECTRON_REBUILD_MODE = "sequential" as const;
export const ELECTRON_REBUILD_NATIVE_MODULES = ["better-sqlite3"] as const;
export const ELECTRON_BUILDER_FILE_PATTERNS = [
  "**/*",
  "!**/node_modules/.bin",
  "!**/node_modules/electron{,/**/*}",
  "!**/*.map",
  "!**/*.tsbuildinfo",
  "!**/.next/cache",
  "!**/.next/cache/**",
  "!**/node_modules/better-sqlite3/build/Release/obj",
  "!**/node_modules/better-sqlite3/build/Release/obj/**",
  "!**/node_modules/better-sqlite3/deps",
  "!**/node_modules/better-sqlite3/deps/**",
] as const;
export const NSIS_INSTALLER_LANGUAGE_BY_WEB_LOCALE = {
  en: "en_US",
  fa: "fa_IR",
  "pt-BR": "pt_BR",
  ru: "ru_RU",
  "zh-CN": "zh_CN",
  "zh-TW": "zh_TW",
} as const;
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
