import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cac } from "cac";
import { afterEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ getStorageObject: vi.fn(), putStorageObject: vi.fn(), putStorageObjectWithStatus: vi.fn() }));
vi.mock("../src/storage/s3-upload.ts", () => storage);

import { allowedUrl, compareVersions, validateRelease } from "../src/openpixo/common.ts";
import { registerOpenPixoCommands } from "../src/openpixo/cli.ts";
import { generateMetadata, parseMetadata } from "../src/openpixo/metadata.ts";
import { publishRelease, rollbackRelease, setMinimumVersion } from "../src/openpixo/publish.ts";
import { hasEmbeddedSignature, type AuthenticodeResult } from "../src/openpixo/authenticode.ts";
import { EMPTY_SITE_MANIFEST, promoteSiteRelease } from "../src/openpixo/site-manifest.ts";

const valid = async (): Promise<AuthenticodeResult> => ({ signed: true, signer: "CN=OpenPixo Fixture", status: "Valid" });
const unsigned = async (): Promise<AuthenticodeResult> => ({ signed: false, status: "NotSigned" });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

async function fixture(version = "0.2.0-beta.1", verifySignature = valid) {
  const artifactsDir = mkdtempSync(join(tmpdir(), "openpixo-release-"));
  dirs.push(artifactsDir);
  writeFileSync(join(artifactsDir, "OpenPixo-setup.exe"), "fixture installer");
  writeFileSync(join(artifactsDir, "OpenPixo-portable.zip"), "fixture portable");
  const channel = version.includes("-beta.") ? "beta" : "stable";
  const options = { artifactsDir, version, channel, verifySignature };
  const metadata = await generateMetadata({ ...options, publicOrigin: "https://downloads.example.test" });
  return { options, metadata };
}

function storageEnv() {
  for (const [key, value] of Object.entries({ ACCESS_KEY_ID: "fixture-ak", SECRET_ACCESS_KEY: "fixture-sk", BUCKET: "fixture-releases", ENDPOINT: "https://storage.example.test", REGION: "auto" })) {
    vi.stubEnv(`RELEASE_STORAGE_${key}`, value);
  }
}

describe("OpenPixo releases", () => {
  it.each(['open-design.ai', 'RELEASES.OPEN-DESIGN.AI.', 's3.nexu.space', 'my-nexu.example.test'])
  ('rejects upstream release origins: %s', host => {
    expect(() => allowedUrl(`https://${host}/releases`)).toThrow(/upstream host is forbidden/);
  });

  it("dispatches metadata and registry keygen through the public CLI", async () => {
    const { options } = await fixture();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cli = cac("tools-release");
    registerOpenPixoCommands(cli);
    cli.parse(["node", "tools-release", "openpixo", "metadata", "--artifacts", options.artifactsDir, "--version", options.version, "--channel", options.channel, "--public-origin", "https://downloads.example.test"], { run: false });
    await cli.runMatchedCommand();
    expect(log.mock.calls.at(-1)?.[0]).toContain("metadata.json and SHA256SUMS.txt (installer signed: false)");
    cli.parse(["node", "tools-release", "openpixo", "registry", "keygen"], { run: false });
    await cli.runMatchedCommand();
    const keypair = JSON.parse(log.mock.calls.at(-1)?.[0] as string);
    expect(keypair.privateKey).toContain("-----BEGIN PRIVATE KEY-----");
    expect(Buffer.from(keypair.publicKey, "base64").length).toBeGreaterThan(32);
  });

  it("writes Windows metadata and SHA256SUMS for the actual bytes", async () => {
    const { options, metadata } = await fixture();
    const sha256 = createHash("sha256").update("fixture installer").digest("hex");
    expect(metadata).toMatchObject({ version: 1, channel: "beta", releaseVersion: "0.2.0-beta.1", releaseState: "complete" });
    // The desktop updater ignores platforms that are not explicitly enabled.
    expect(metadata.platforms.win).toMatchObject({ arch: "x64", channel: "beta", enabled: true, platformKey: "win", signed: true, signer: "CN=OpenPixo Fixture" });
    expect(metadata.platforms.win.artifacts.installer).toMatchObject({
      sha256, size: Buffer.byteLength("fixture installer"),
      url: "https://downloads.example.test/releases/0.2.0-beta.1/OpenPixo-setup.exe",
    });
    expect(readFileSync(join(options.artifactsDir, "SHA256SUMS.txt"), "utf8")).toContain(`${sha256}  OpenPixo-setup.exe\n`);
    expect(readFileSync(join(options.artifactsDir, "OpenPixo-setup.exe.sha256"), "utf8")).toBe(`${sha256}\n`);
    expect(JSON.parse(readFileSync(join(options.artifactsDir, "metadata.json"), "utf8"))).toEqual(metadata);
    expect(metadata).not.toHaveProperty("r2");
  });

  it.each([
    ["0.2.0", "preview"], ["0.2.0", "prerelease"], ["0.2.0-alpha.1", "beta"],
    ["v0.2.0", "stable"], ["01.2.0", "stable"], ["0.2.0-beta.1", "stable"],
    ["0.2.0", "beta"], ["../0.2.0", "stable"], ["0.2.0-beta.01", "beta"],
  ])("rejects version/channel %s %s", (version, channel) => {
    expect(() => validateRelease(version, channel)).toThrow();
  });

  it("accepts the two public channel/version forms and compares beta counters numerically", () => {
    expect(validateRelease("0.2.0-beta.1", "beta")).toBe("beta");
    expect(validateRelease("0.2.0", "stable")).toBe("stable");
    expect(compareVersions("0.2.0-beta.10", "0.2.0-beta.2")).toBe(1);
    expect(compareVersions("0.2.0", "0.2.0-beta.10")).toBe(1);
  });

  it("prints a credential-free dry-run plan with latest metadata last, without uploading", async () => {
    const { options } = await fixture();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const plan = await publishRelease({ ...options, dryRun: true });
    expect(plan.slice(0, -1).every((entry) => entry.objectKey.startsWith("releases/0.2.0-beta.1/"))).toBe(true);
    expect(plan.at(-2)?.objectKey).toBe("releases/0.2.0-beta.1/metadata.json");
    expect(plan.at(-1)?.objectKey).toBe("updates/beta/latest/metadata.json");
    const puts = log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("[dry-run] PUT "));
    expect(puts.at(-1)).toContain("updates/beta/latest/metadata.json");
    expect(log.mock.calls.at(-1)?.[0]).toBe("[dry-run] signature: Valid. Re-run with --execute to upload.");
    expect(storage.putStorageObject).not.toHaveBeenCalled();
    expect(storage.putStorageObjectWithStatus).not.toHaveBeenCalled();
    expect(storage.getStorageObject).not.toHaveBeenCalled();
  });

  it("does not advance latest when an immutable upload fails or an artifact changed", async () => {
    const { options } = await fixture();
    storageEnv();
    storage.putStorageObjectWithStatus.mockResolvedValue({ ok: false, status: 403 });
    await expect(publishRelease(options)).rejects.toThrow(/immutable upload failed/);
    expect(storage.putStorageObject).not.toHaveBeenCalled();
    writeFileSync(join(options.artifactsDir, "OpenPixo-setup.exe"), "changed");
    await expect(publishRelease({ ...options, dryRun: true })).rejects.toThrow(/artifact changed/);
  });

  it("retries identical immutable objects, rejects conflicting bytes, and writes latest last", async () => {
    const { options } = await fixture();
    storageEnv();
    vi.spyOn(console, "log").mockImplementation(() => {});
    storage.putStorageObjectWithStatus.mockResolvedValue({ ok: true, status: 200 }).mockResolvedValueOnce({ ok: false, status: 412 });
    storage.getStorageObject.mockImplementationOnce(async (request) => ({
      bytes: readFileSync(join(options.artifactsDir, request.objectKey.split("/").at(-1)!)),
    }));
    await publishRelease(options);
    expect(storage.putStorageObjectWithStatus.mock.calls.every(([request]) => request.headers["if-none-match"] === "*")).toBe(true);
    expect(storage.putStorageObject).toHaveBeenCalledWith(expect.objectContaining({
      objectKey: "updates/beta/latest/metadata.json",
      body: readFileSync(join(options.artifactsDir, "metadata.json")),
    }));
    expect(storage.putStorageObject.mock.invocationCallOrder[0]).toBeGreaterThan(storage.putStorageObjectWithStatus.mock.invocationCallOrder.at(-1)!);
    storage.putStorageObject.mockClear();
    storage.putStorageObjectWithStatus.mockResolvedValueOnce({ ok: false, status: 412 });
    storage.getStorageObject.mockResolvedValueOnce({ bytes: Buffer.from("different release") });
    await expect(publishRelease(options)).rejects.toThrow(/immutable upload failed/);
    expect(storage.putStorageObject).not.toHaveBeenCalled();
  });

  it("rolls back exact published bytes with a conditional latest-pointer write", async () => {
    const { metadata: old } = await fixture("0.2.0-beta.1");
    const { metadata: current } = await fixture("0.2.0-beta.2");
    const bytes = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
    const currentBytes = bytes(current);
    const oldBytes = bytes(old);
    storageEnv();
    storage.getStorageObject.mockResolvedValueOnce({ bytes: currentBytes, text: currentBytes.toString(), etag: '"current"' })
      .mockResolvedValueOnce({ bytes: oldBytes, text: oldBytes.toString(), etag: '"old"' });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await rollbackRelease({ version: "0.2.0-beta.1", channel: "beta" });
    expect(storage.putStorageObject).toHaveBeenCalledWith(expect.objectContaining({
      objectKey: "updates/beta/latest/metadata.json", body: oldBytes, headers: { "if-match": '"current"' },
    }));
    storage.getStorageObject.mockResolvedValueOnce({ bytes: currentBytes, text: currentBytes.toString(), etag: '"current"' });
    await expect(rollbackRelease({ version: "0.2.0-beta.3", channel: "beta" })).rejects.toThrow(/earlier/);
  });

  it("publishes a minimum usable version the release itself clears", async () => {
    const { options } = await fixture("0.2.0-beta.2");
    const metadata = await generateMetadata({
      ...options,
      minimumVersion: { message: { en: "Saving is broken", "zh-CN": "保存有问题" }, min: "0.2.0-beta.2", url: "https://openpixo.com/download" },
    });
    expect(metadata.control?.app.version.min).toBe("0.2.0-beta.2");
    expect(parseMetadata(Buffer.from(JSON.stringify(metadata)), "0.2.0-beta.2", "beta").control?.app.version.message?.en).toBe("Saving is broken");
  });

  it("refuses a floor above the release, a wrong-channel floor, and a plain-http download page", async () => {
    const { options } = await fixture("0.2.0-beta.2");
    await expect(generateMetadata({ ...options, minimumVersion: { min: "0.2.0-beta.3" } })).rejects.toThrow(/no update could satisfy it/);
    await expect(generateMetadata({ ...options, minimumVersion: { min: "0.2.0" } })).rejects.toThrow();
    await expect(generateMetadata({ ...options, minimumVersion: { min: "0.2.0-beta.1", url: "http://x.test" } })).rejects.toThrow(/https/);
  });

  it("raises and clears the floor on the live feed only, with a conditional write and a dry-run default", async () => {
    const { metadata } = await fixture("0.2.0-beta.2");
    const bytes = Buffer.from(`${JSON.stringify(metadata)}\n`);
    storageEnv();
    vi.spyOn(console, "log").mockImplementation(() => {});
    storage.getStorageObject.mockResolvedValue({ bytes, etag: '"live"', text: bytes.toString() });

    await setMinimumVersion({ channel: "beta", dryRun: true, minimumVersion: { min: "0.2.0-beta.2" } });
    expect(storage.putStorageObject).not.toHaveBeenCalled();

    await setMinimumVersion({ channel: "beta", minimumVersion: { min: "0.2.0-beta.2" } });
    const raised = storage.putStorageObject.mock.calls[0]?.[0];
    expect(raised).toMatchObject({ headers: { "if-match": '"live"' }, objectKey: "updates/beta/latest/metadata.json" });
    expect(JSON.parse(raised.body.toString()).control.app.version.min).toBe("0.2.0-beta.2");

    const withFloor = Buffer.from(raised.body);
    storage.getStorageObject.mockResolvedValue({ bytes: withFloor, etag: '"raised"', text: withFloor.toString() });
    await setMinimumVersion({ channel: "beta", minimumVersion: null });
    expect(JSON.parse(storage.putStorageObject.mock.calls[1]?.[0].body.toString()).control).toBeUndefined();

    await expect(setMinimumVersion({ channel: "beta", minimumVersion: { min: "0.2.0-beta.9" } })).rejects.toThrow(/no update could satisfy it/);
  });

  it("refuses to publish an unsigned installer as a release before touching storage", async () => {
    const { options } = await fixture("0.2.0", unsigned);
    storageEnv();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(publishRelease({ ...options, verifySignature: unsigned })).rejects.toThrow(/refusing to publish an unsigned build.*NotSigned/);
    // Metadata recorded the unsigned build, so signing the file afterwards is not enough on its own.
    await expect(publishRelease({ ...options, verifySignature: valid })).rejects.toThrow(/regenerate/);
    expect(storage.putStorageObject).not.toHaveBeenCalled();
    expect(storage.putStorageObjectWithStatus).not.toHaveBeenCalled();
    await publishRelease({ ...options, dryRun: true });
    expect(log.mock.calls.at(-1)?.[0]).toBe("[dry-run] --execute would be refused: installer Authenticode status is NotSigned (--allow-unsigned publishes it anyway)");
    await publishRelease({ ...options, allowUnsigned: true, dryRun: true });
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/WARNING: .*NotSigned.*UNSIGNED release/);
  });

  it("publishes an unsigned installer only with --allow-unsigned, warning and recording signed: false", async () => {
    const { options, metadata } = await fixture("0.2.0", unsigned);
    expect(metadata.platforms.win.signed).toBe(false);
    storageEnv();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    storage.putStorageObjectWithStatus.mockResolvedValue({ ok: true, status: 200 });
    await publishRelease({ ...options, allowUnsigned: true });
    expect(warn.mock.calls[0]?.[0]).toMatch(/publishing an UNSIGNED release.*signed: false/);
    const latest = storage.putStorageObject.mock.calls.at(-1)?.[0];
    expect(latest.objectKey).toBe("updates/stable/latest/metadata.json");
    expect(JSON.parse(latest.body.toString()).platforms.win.signed).toBe(false);
    // The flag never lets metadata claim a signature the installer lacks.
    await expect(publishRelease({ ...options, allowUnsigned: true, verifySignature: valid })).rejects.toThrow(/regenerate/);
  });

  it("passes --allow-unsigned through the CLI and keeps dry-run as the default", async () => {
    const { options } = await fixture("0.2.0", unsigned);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cli = cac("tools-release");
    registerOpenPixoCommands(cli);
    cli.parse(["node", "tools-release", "openpixo", "publish", "--artifacts", options.artifactsDir, "--version", "0.2.0", "--channel", "stable", "--allow-unsigned"], { run: false });
    await cli.runMatchedCommand();
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/^\[dry-run\] WARNING: /);
    expect(storage.putStorageObjectWithStatus).not.toHaveBeenCalled();
  });

  it("dry-runs publish by default from the CLI and prints the public URLs", async () => {
    const { options } = await fixture("0.2.0", unsigned);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cli = cac("tools-release");
    registerOpenPixoCommands(cli);
    cli.parse(["node", "tools-release", "openpixo", "publish", "--artifacts", options.artifactsDir, "--version", "0.2.0", "--channel", "stable"], { run: false });
    await cli.runMatchedCommand();
    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines).toContain("[dry-run] installer: https://downloads.example.test/releases/0.2.0/OpenPixo-setup.exe");
    expect(lines).toContain("[dry-run] checksums: https://downloads.example.test/releases/0.2.0/SHA256SUMS.txt");
    expect(lines).toContain("[dry-run] feed:      https://downloads.example.test/updates/stable/latest/metadata.json");
    expect(lines[0]).toMatch(/release builds read https:\/\/downloads\.openpixo\.com/);
    expect(storage.putStorageObject).not.toHaveBeenCalled();
    expect(storage.putStorageObjectWithStatus).not.toHaveBeenCalled();
  });

  it("defaults the public origin to the OpenPixo downloads domain", async () => {
    const { options } = await fixture("0.2.0");
    const metadata = await generateMetadata({ ...options, publicOrigin: undefined });
    expect(metadata.platforms.win.artifacts.installer.url).toBe("https://downloads.openpixo.com/releases/0.2.0/OpenPixo-setup.exe");
  });

  it("promotes only signed stable releases onto the download page and keeps history newest first", async () => {
    const { metadata: first } = await fixture("0.2.0");
    const { metadata: second } = await fixture("0.2.1");
    const once = promoteSiteRelease(EMPTY_SITE_MANIFEST, first);
    expect(once.current).toMatchObject({ version: "0.2.0", downloadBaseUrl: "https://downloads.example.test/releases/0.2.0" });
    expect(once.current?.artifacts).toEqual([{ fileName: "OpenPixo-setup.exe", size: first.platforms.win.artifacts.installer.size, sha256: first.platforms.win.artifacts.installer.sha256 }]);
    const twice = promoteSiteRelease(once, second);
    expect([twice.current?.version, ...twice.history.map((item) => item.version)]).toEqual(["0.2.1", "0.2.0"]);
    expect(() => promoteSiteRelease(twice, first)).toThrow(/newer release/);
    const { metadata: beta } = await fixture("0.2.2-beta.1");
    expect(() => promoteSiteRelease(twice, beta)).toThrow(/stable releases only/);
    const { metadata: unsignedRelease } = await fixture("0.3.0", unsigned);
    expect(() => promoteSiteRelease(twice, unsignedRelease)).toThrow(/unsigned/);
    const listed = promoteSiteRelease(twice, unsignedRelease, { allowUnsigned: true });
    expect(listed.current).toMatchObject({ signed: false, version: "0.3.0" });
    expect(listed.history[0]).toMatchObject({ signed: true, version: "0.2.1" });
  });

  it("tells unsigned PE images apart from ones carrying a certificate table", async () => {
    const dir = mkdtempSync(join(tmpdir(), "openpixo-pe-"));
    dirs.push(dir);
    const pe = (certificateSize: number) => {
      const image = Buffer.alloc(512);
      image.writeUInt16LE(0x5a4d, 0);
      image.writeUInt32LE(0x80, 0x3c);
      image.writeUInt32LE(0x00004550, 0x80);
      image.writeUInt16LE(0x20b, 0x80 + 24);
      const security = 0x80 + 24 + 112 + 4 * 8;
      image.writeUInt32LE(certificateSize ? 0x180 : 0, security);
      image.writeUInt32LE(certificateSize, security + 4);
      return image;
    };
    writeFileSync(join(dir, "unsigned.exe"), pe(0));
    writeFileSync(join(dir, "signed.exe"), pe(64));
    writeFileSync(join(dir, "text.exe"), "not a PE image");
    await expect(hasEmbeddedSignature(join(dir, "unsigned.exe"))).resolves.toBe(false);
    await expect(hasEmbeddedSignature(join(dir, "signed.exe"))).resolves.toBe(true);
    await expect(hasEmbeddedSignature(join(dir, "text.exe"))).resolves.toBe(false);
  });
});
