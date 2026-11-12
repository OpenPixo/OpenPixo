import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { writeJson } from "../storage/common.ts";
import { listFiles, validateUrls } from "./common.ts";
import blockedTerms from "./ip-keywords.json" with { type: "json" };

type RegistryItem = {
  name: string;
  version: string;
  kind: string;
  path: string;
  license: string;
  description?: string;
  assetLicense?: { commercialUse: boolean; attributionRequired: boolean };
  pricing: { type: "free" | "paid"; credits?: number; sku?: string };
  engines?: string[];
  requires?: Record<string, unknown>;
  previews?: string[];
};

function validateItem(value: unknown): RegistryItem {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("registry item must be an object");
  const item = value as RegistryItem;
  const segment = /^[a-z0-9][a-z0-9._-]*$/;
  if (typeof item.name !== "string" || !item.name.split("/").every((part) => segment.test(part))) throw new Error("invalid item name");
  if (typeof item.version !== "string" || !/^\d+\.\d+\.\d+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/.test(item.version)) throw new Error("invalid item version");
  if (!["skill", "recipe", "mcp", "project-template", "asset-pack", "character-card"].includes(item.kind)) throw new Error("invalid item kind");
  if (typeof item.path !== "string" || !item.path) throw new Error("path is required");
  if (typeof item.license !== "string" || !item.license.trim()) throw new Error(`license is required: ${item.name}`);
  if ((item.kind === "asset-pack" || item.assetLicense != null) && (typeof item.assetLicense?.commercialUse !== "boolean" || typeof item.assetLicense.attributionRequired !== "boolean")) {
    throw new Error(`assetLicense with commercialUse and attributionRequired is required: ${item.name}`);
  }
  if (item.description != null && typeof item.description !== "string") throw new Error("description must be a string");
  const text = `${item.name} ${item.description ?? ""}`.normalize("NFKC").toLowerCase();
  const term = blockedTerms.find((keyword) => text.includes(keyword));
  if (term) throw new Error(`IP keyword '${term}' blocks publication: ${item.name}`);
  if (item.pricing?.type !== "free" && item.pricing?.type !== "paid") throw new Error("pricing.type must be free or paid");
  if (item.pricing.credits != null && (!Number.isSafeInteger(item.pricing.credits) || item.pricing.credits < (item.pricing.type === "paid" ? 1 : 0))) throw new Error("pricing.credits must be a nonnegative integer, positive for paid items");
  if (item.pricing.sku != null && (typeof item.pricing.sku !== "string" || !item.pricing.sku.trim())) throw new Error("pricing.sku must be a nonempty string");
  for (const field of ["engines", "previews"] as const) {
    if (item[field] != null && (!Array.isArray(item[field]) || !item[field].every((entry) => typeof entry === "string" && entry.trim()))) throw new Error(`${field} must be a nonempty string array`);
  }
  if (item.requires != null && (typeof item.requires !== "object" || Array.isArray(item.requires))) throw new Error("requires must be an object");
  if (item.requires?.openpixo != null && (typeof item.requires.openpixo !== "string" || !item.requires.openpixo.trim())) throw new Error("requires.openpixo must be a nonempty string");
  if (item.requires?.capabilities != null && (!Array.isArray(item.requires.capabilities) || !item.requires.capabilities.every((entry) => typeof entry === "string" && entry.trim()))) throw new Error("requires.capabilities must be a string array");
  validateUrls(item);
  return item;
}

function zipDirectory(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { force: true });
  if (process.platform === "win32") {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:OPENPIXO_ZIP_SOURCE, $env:OPENPIXO_ZIP_TARGET)"],
    { env: { ...process.env, OPENPIXO_ZIP_SOURCE: source, OPENPIXO_ZIP_TARGET: target }, windowsHide: true, stdio: "pipe" });
  } else {
    execFileSync("zip", ["-qr", target, "."], { cwd: source, stdio: "pipe" });
  }
}

export function buildRegistry(options: { indexPath: string; outDir: string }) {
  const input: unknown = JSON.parse(readFileSync(options.indexPath, "utf8"));
  const rows = Array.isArray(input) ? input : (input as { items?: unknown } | null)?.items;
  if (!Array.isArray(rows)) throw new Error("index must be an array of items or an object with items[]");
  const outDir = resolve(options.outDir);
  const seen = new Set<string>();
  const staged = rows.map((row) => {
    const item = validateItem(row);
    if (seen.has(item.name)) throw new Error(`duplicate registry item: ${item.name}`);
    seen.add(item.name);
    const source = resolve(dirname(resolve(options.indexPath)), item.path);
    if (!lstatSync(source).isDirectory()) throw new Error(`item path must be a directory, without links: ${source}`);
    const outputRelative = relative(source, outDir);
    if (!outputRelative || (!outputRelative.startsWith(`..\\`) && !outputRelative.startsWith("../") && outputRelative !== ".." && !isAbsolute(outputRelative))) {
      throw new Error("registry output must be outside every item directory");
    }
    if (!listFiles(source).length) throw new Error(`item directory is empty: ${source}`);
    return { item, source };
  });
  const plugins = staged.map(({ item, source }) => {
    const archivePath = `${item.name}/${item.version}.zip`;
    // Public URLs resolve beside v1/marketplace.json; paid archives stay outside v1/.
    const target = item.pricing.type === "free" ? join(outDir, "v1", "free", archivePath) : join(outDir, "paid", archivePath);
    zipDirectory(source, target);
    const bytes = readFileSync(target);
    const url = item.pricing.type === "free" ? `free/${archivePath}` : "paid";
    const { path: _localPath, ...entry } = item;
    return { ...entry, source: url, archive: { url, integrity: `sha256-${createHash("sha256").update(bytes).digest("base64")}`, size: bytes.length } };
  });
  const marketplace = { specVersion: "1.0.0", name: "openpixo-official", version: "1.0.0", plugins };
  writeJson(join(outDir, "v1", "marketplace.json"), marketplace);
  return marketplace;
}

export function signRegistry(file: string, env: NodeJS.ProcessEnv = process.env) {
  const pem = env.OPENPIXO_REGISTRY_SIGNING_KEY;
  const keyId = env.OPENPIXO_REGISTRY_KEY_ID?.trim();
  if (!pem?.includes("-----BEGIN PRIVATE KEY-----") || !keyId) throw new Error("OPENPIXO_REGISTRY_SIGNING_KEY (PKCS8 PEM) and OPENPIXO_REGISTRY_KEY_ID are required");
  const privateKey = createPrivateKey({ key: pem, format: "pem", type: "pkcs8" });
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("registry signing key must be Ed25519");
  const signature = { alg: "ed25519", keyId, signature: sign(null, readFileSync(file), privateKey).toString("base64") };
  writeFileSync(`${file}.sig`, `${JSON.stringify(signature)}\n`);
  return signature;
}

export function generateRegistryKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}
