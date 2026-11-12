import { readFileSync } from "node:fs";

export type Locale = "en" | "zh-CN";
export interface Card {
  name: string;
  title: string;
  description: string;
  title_i18n?: Partial<Record<Locale, string>>;
  description_i18n?: Partial<Record<Locale, string>>;
  /** Recipe surface (image, audio, model3d, video, code) and category; the site groups its gallery by them. */
  surface?: string;
  category?: string;
}
export interface StoreEntry extends Card {
  license: string;
  pricing?: { type: "free" | "paid"; credits?: number };
  /** Registry item kind (skill, recipe, project-template, mcp) and supported engines. */
  kind?: string;
  engines?: string[];
}
export interface Release {
  version: string;
  date: string;
  downloadBaseUrl: string;
  artifacts: { fileName: string; size: number; sha256: string }[];
  /** False when the installer was published without an Authenticode signature; absent for older entries. */
  signed?: boolean;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Expected a non-empty string");
  return value;
}

function localized(value: unknown): Card["title_i18n"] {
  if (value === undefined) return undefined;
  const source = object(value);
  return Object.fromEntries(["en", "zh-CN"].filter((key) => source[key] !== undefined).map((key) => [key, text(source[key])]));
}

function card(value: unknown): Card {
  const source = object(value);
  return {
    name: text(source.name), title: text(source.title ?? source.name),
    description: source.description === undefined ? "" : text(source.description),
    title_i18n: localized(source.title_i18n), description_i18n: localized(source.description_i18n),
  };
}

function release(value: unknown): Release {
  const source = object(value);
  if (source.version === 1) {
    const win = object(object(source.platforms).win);
    if (source.releaseState !== "complete" || win.arch !== "x64") throw new Error("Expected complete Windows x64 release metadata");
    const artifacts = object(win.artifacts);
    const installerUrl = text(object(artifacts.installer).url);
    const base = installerUrl.slice(0, installerUrl.lastIndexOf("/"));
    return release({
      version: source.releaseVersion, date: text(source.generatedAt).slice(0, 10), downloadBaseUrl: base,
      ...(typeof win.signed === "boolean" ? { signed: win.signed } : {}),
      artifacts: Object.values(artifacts).map((value) => {
        const artifact = object(value);
        if (text(artifact.url) !== `${base}/${encodeURIComponent(text(artifact.name))}`) throw new Error("Release artifact URLs must share the download base URL");
        return { fileName: artifact.name, size: artifact.size, sha256: artifact.sha256 };
      }),
    });
  }
  const date = text(source.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw new Error("Release date must be YYYY-MM-DD");
  }
  if (!Array.isArray(source.artifacts) || !source.artifacts.length) throw new Error("Release artifacts are required");
  const artifacts = source.artifacts.map((value) => {
    const artifact = object(value);
    const fileName = text(artifact.fileName);
    const sha256 = text(artifact.sha256);
    if (/[\\/\x00-\x1f]/.test(fileName) || fileName === "." || fileName === "..") throw new Error("Artifact must be a file name");
    if (!Number.isSafeInteger(artifact.size) || Number(artifact.size) <= 0) throw new Error("Artifact size must be positive bytes");
    if (!/^[a-f\d]{64}$/i.test(sha256)) throw new Error("Artifact SHA256 must contain 64 hex digits");
    return { fileName, size: Number(artifact.size), sha256: sha256.toLowerCase() };
  });
  if (!artifacts.some((item) => /\.exe$/i.test(item.fileName))) throw new Error("Release must include a Windows installer (.exe)");
  if (source.signed !== undefined && typeof source.signed !== "boolean") throw new Error("Release signed must be a boolean");
  return {
    version: text(source.version), date, downloadBaseUrl: text(source.downloadBaseUrl), artifacts,
    ...(typeof source.signed === "boolean" ? { signed: source.signed } : {}),
  };
}

/**
 * The committed download-page manifest: `{ current, history }`, where a null
 * `current` means no public build exists yet.
 */
export function parseSiteManifest(value: unknown): { current: Release | null; history: Release[] } {
  const source = object(value);
  if (!("current" in source) || !Array.isArray(source.history)) throw new Error("Site manifest needs current and history");
  if (source.current === null && source.history.length) throw new Error("Site manifest history requires a current release");
  return { current: source.current === null ? null : release(source.current), history: source.history.map(release) };
}

export function parseMarketplace(value: unknown): StoreEntry[] {
  const source = object(value);
  if (!Array.isArray(source.plugins)) throw new Error("Marketplace plugins must be an array");
  return source.plugins.map((value) => {
    const entry = object(value);
    let pricing: StoreEntry["pricing"];
    if (entry.pricing !== undefined) {
      const price = object(entry.pricing);
      if (price.type !== "free" && price.type !== "paid") throw new Error("Unknown marketplace pricing type");
      if (price.type === "paid" && (!Number.isSafeInteger(price.credits) || Number(price.credits) <= 0)) {
        throw new Error("Paid entries require a positive integer credit price");
      }
      pricing = { type: price.type, credits: price.type === "paid" ? Number(price.credits) : undefined };
    }
    const engines = Array.isArray(entry.engines) ? entry.engines.filter((value): value is string => typeof value === "string" && !!value.trim()) : undefined;
    return {
      ...card(entry), license: entry.license === undefined ? "" : text(entry.license), pricing,
      ...(typeof entry.kind === "string" && entry.kind.trim() ? { kind: entry.kind } : {}),
      ...(engines?.length ? { engines } : {}),
    };
  });
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** One official recipe as the website lists it, read from its `pixo.json`; recipes only. */
export function readRecipe(manifestPath: string): Card | undefined {
  const manifest = object(readJson(manifestPath));
  const pixo = object(manifest.pixo);
  if (pixo.kind !== "recipe") return undefined;
  const recipe = pixo.recipe && typeof pixo.recipe === "object" && !Array.isArray(pixo.recipe) ? pixo.recipe as Record<string, unknown> : {};
  return { ...card(manifest), surface: optionalText(recipe.surface), category: optionalText(recipe.category) };
}
