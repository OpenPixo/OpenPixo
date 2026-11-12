import { createHash } from "node:crypto";
import { createReadStream, readdirSync } from "node:fs";
import { join } from "node:path";
import { isUpstreamHost } from "@openpixo/contracts";

export type Channel = "beta" | "stable";
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.(0|[1-9]\d*))?$/;

export function validateRelease(version: string, channel: string): Channel {
  if (channel !== "beta" && channel !== "stable") throw new Error("channel must be beta or stable");
  if (!VERSION.test(version)) throw new Error("version must be MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-beta.N");
  if ((channel === "beta") !== version.includes("-beta.")) {
    throw new Error("beta requires -beta.N; stable requires MAJOR.MINOR.PATCH");
  }
  return channel;
}

export function compareVersions(left: string, right: string): number {
  const parts = (version: string) => version.split(/\.|-beta\./).map(BigInt);
  const a = parts(left);
  const b = parts(right);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  if (a[3] === b[3]) return 0;
  if (a[3] == null) return 1;
  if (b[3] == null) return -1;
  return a[3] > b[3] ? 1 : -1;
}

export function allowedUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (isUpstreamHost(host, 'release')) {
    throw new Error(`upstream host is forbidden: ${host}`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("release URLs must use HTTPS without credentials, query, or fragment");
  }
  return url;
}

export function validateUrls(value: unknown): void {
  if (typeof value === "string" && /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(value)) {
    allowedUrl(value.startsWith("//") ? `https:${value}` : value);
  } else if (Array.isArray(value)) {
    value.forEach(validateUrls);
  } else if (value != null && typeof value === "object") {
    Object.values(value).forEach(validateUrls);
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function listFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`only regular files and directories are allowed: ${path}`);
  }
  return files.sort();
}
