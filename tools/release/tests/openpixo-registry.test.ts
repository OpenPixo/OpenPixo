import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildRegistry, generateRegistryKeypair, signRegistry } from "../src/openpixo/registry.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(overrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "openpixo-registry-"));
  dirs.push(root);
  const source = join(root, "item");
  mkdirSync(source);
  writeFileSync(join(source, "SKILL.md"), "# Original game skill\n");
  writeFileSync(join(source, ".hidden"), "included");
  const item = { name: "openpixo/game-skill", version: "0.4.0", kind: "skill", path: "item", license: "MIT", pricing: { type: "free" }, ...overrides };
  const indexPath = join(root, "index.json");
  const outDir = join(root, "output");
  writeFileSync(indexPath, JSON.stringify([item]));
  return { root, item, indexPath, outDir };
}

describe("OpenPixo registry", () => {
  it("writes a real ZIP and its integrity/size, without leaking local paths", () => {
    const options = fixture();
    const marketplace = buildRegistry(options);
    const entry = marketplace.plugins[0];
    const zip = readFileSync(join(options.outDir, "v1", entry.archive.url));
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.includes(Buffer.from("SKILL.md"))).toBe(true);
    expect(zip.includes(Buffer.from(".hidden"))).toBe(true);
    expect(entry.archive).toEqual({ url: "free/openpixo/game-skill/0.4.0.zip", integrity: `sha256-${createHash("sha256").update(zip).digest("base64")}`, size: zip.length });
    expect(entry).not.toHaveProperty("path");
    expect(JSON.parse(readFileSync(join(options.outDir, "v1/marketplace.json"), "utf8"))).toEqual(marketplace);
  });

  it("keeps paid archives outside the public v1 tree and uses the paid sentinel", () => {
    const options = fixture({ pricing: { type: "paid", credits: 300, sku: "item.game-skill" } });
    const entry = buildRegistry(options).plugins[0];
    expect(entry.archive.url).toBe("paid");
    expect(existsSync(join(options.outDir, "paid/openpixo/game-skill/0.4.0.zip"))).toBe(true);
    expect(existsSync(join(options.outDir, "v1/paid"))).toBe(false);
  });

  it.each([
    [{ license: "" }, /license is required/],
    [{ kind: "asset-pack" }, /assetLicense/],
    [{ description: "PoKeMoN sprites" }, /IP keyword/],
    [{ name: "openpixo/mario-skill" }, /IP keyword/],
    [{ name: "../escape" }, /invalid item name/],
  ])("rejects invalid registry entries: %j", (overrides, message) => {
    const options = fixture(overrides);
    expect(() => buildRegistry(options)).toThrow(message);
    expect(existsSync(options.outDir)).toBe(false);
  });

  it("signs exact bytes with Ed25519 and emits the daemon's detached-signature format", () => {
    const { root } = fixture();
    const file = join(root, "marketplace.json");
    const bytes = Buffer.from('{ "plugins": [] }\r\n');
    writeFileSync(file, bytes);
    const keys = generateRegistryKeypair();
    const signature = signRegistry(file, { OPENPIXO_REGISTRY_SIGNING_KEY: keys.privateKey, OPENPIXO_REGISTRY_KEY_ID: "test-key" });
    const publicKey = createPublicKey({ key: Buffer.from(keys.publicKey, "base64"), format: "der", type: "spki" });
    expect(JSON.parse(readFileSync(`${file}.sig`, "utf8"))).toEqual(signature);
    expect(Object.keys(signature)).toEqual(["alg", "keyId", "signature"]);
    expect(signature.alg).toBe("ed25519");
    expect(verify(null, bytes, publicKey, Buffer.from(signature.signature, "base64"))).toBe(true);
    expect(verify(null, Buffer.from('{"plugins":[]}\n'), publicKey, Buffer.from(signature.signature, "base64"))).toBe(false);
    expect(readFileSync(file)).toEqual(bytes);
    expect(() => signRegistry(file, {})).toThrow(/SIGNING_KEY/);
  });
});
