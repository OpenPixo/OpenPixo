import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  azureArtifactSigningMetadata,
  resolveSigntoolPath,
  resolveWinSigningCacheKey,
  resolveWinSigningConfig,
  winSignArgs,
  type WinAzureArtifactSigningConfig,
} from "@/win/sign.js";
import type { ToolPackConfig } from "@/config/index.js";

describe("resolveSigntoolPath", () => {
  it("probes filesystem candidates before falling back to bare signtool", async () => {
    const root = await mkdtemp(join(tmpdir(), "openpixo-win-sign-"));
    const kitSigntool = join(root, "Windows Kits", "signtool.exe");

    try {
      await mkdir(join(root, "Windows Kits"), { recursive: true });
      await writeFile(kitSigntool, "");

      await expect(resolveSigntoolPath("signtool.exe", ["signtool.exe", kitSigntool])).resolves.toBe(kitSigntool);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("falls back to bare signtool only after filesystem candidates are exhausted", async () => {
    const root = await mkdtemp(join(tmpdir(), "openpixo-win-sign-"));

    try {
      await expect(resolveSigntoolPath("signtool.exe", ["signtool.exe", join(root, "missing.exe")])).resolves.toBe(
        "signtool.exe",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps an explicit configured signtool path preferred", async () => {
    const root = await mkdtemp(join(tmpdir(), "openpixo-win-sign-"));
    const configuredSigntool = join(root, "configured.exe");
    const kitSigntool = join(root, "kit.exe");

    try {
      await writeFile(configuredSigntool, "");
      await writeFile(kitSigntool, "");

      await expect(resolveSigntoolPath(configuredSigntool, ["signtool.exe", kitSigntool])).resolves.toBe(
        configuredSigntool,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("uses a filesystem fallback when an explicit configured signtool path is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "openpixo-win-sign-"));
    const kitSigntool = join(root, "kit.exe");

    try {
      await writeFile(kitSigntool, "");

      await expect(resolveSigntoolPath(join(root, "missing.exe"), ["signtool.exe", kitSigntool])).resolves.toBe(
        kitSigntool,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

const azureEnv = {
  PIXO_WIN_SIGN_AZURE_ACCOUNT: "openpixo-signing",
  PIXO_WIN_SIGN_AZURE_DLIB: "C:\\tools\\artifact-signing\\bin\\x64\\Azure.CodeSigning.Dlib.dll",
  PIXO_WIN_SIGN_AZURE_ENDPOINT: "https://eus.codesigning.azure.net/",
  PIXO_WIN_SIGN_AZURE_PROFILE: "openpixo-public",
};

describe("resolveWinSigningConfig", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the certificate-thumbprint path and its signtool argv unchanged", () => {
    const signing = resolveWinSigningConfig({ PIXO_WIN_SIGN_CERT_SHA1: "ab".repeat(20) });
    expect(signing.method).toBe("certificate");
    expect(winSignArgs(signing, "setup.exe")).toEqual([
      "sign", "/sha1", "AB".repeat(20), "/fd", "sha256", "/tr", "http://timestamp.digicert.com", "/td", "sha256", "setup.exe",
    ]);
  });

  it("selects Azure Artifact Signing from its account and signs through the dlib with the service timestamp", () => {
    const signing = resolveWinSigningConfig(azureEnv) as WinAzureArtifactSigningConfig;
    expect(signing).toMatchObject({ endpoint: "https://eus.codesigning.azure.net", method: "azure-artifact-signing" });
    expect(azureArtifactSigningMetadata(signing)).toEqual({
      CertificateProfileName: "openpixo-public",
      CodeSigningAccountName: "openpixo-signing",
      Endpoint: "https://eus.codesigning.azure.net",
    });
    expect(winSignArgs(signing, "setup.exe", "meta.json")).toEqual([
      "sign", "/v", "/fd", "sha256", "/tr", "http://timestamp.acs.microsoft.com", "/td", "sha256",
      "/dlib", azureEnv.PIXO_WIN_SIGN_AZURE_DLIB, "/dmdf", "meta.json", "setup.exe",
    ]);
    expect(() => winSignArgs(signing, "setup.exe")).toThrow(/metadata file/);
  });

  it.each([
    [{ ...azureEnv, PIXO_WIN_SIGN_AZURE_PROFILE: "" }, /PIXO_WIN_SIGN_AZURE_PROFILE/],
    [{ ...azureEnv, PIXO_WIN_SIGN_AZURE_ENDPOINT: "https://eus.example.test" }, /codesigning\.azure\.net/],
    [{ ...azureEnv, PIXO_WIN_SIGN_AZURE_ENDPOINT: "http://eus.codesigning.azure.net" }, /codesigning\.azure\.net/],
    [{ ...azureEnv, PIXO_WIN_SIGN_AZURE_DLIB: "Azure.CodeSigning.Dlib.dll" }, /absolute path/],
    [{ PIXO_WIN_SIGN_METHOD: "pfx" }, /certificate or azure-artifact-signing/],
    [{}, /PIXO_WIN_SIGN_CERT_SHA1/],
  ])("rejects incomplete signing configuration %#", (env, message) => {
    expect(() => resolveWinSigningConfig(env)).toThrow(message);
  });

  it("keys signed caches by the Artifact Signing account and profile, not a rotating thumbprint", () => {
    for (const [key, value] of Object.entries(azureEnv)) vi.stubEnv(key, value);
    const config = { signed: true } as ToolPackConfig;
    const key = resolveWinSigningCacheKey(config);
    expect(key).toMatchObject({ accountName: "openpixo-signing", certificateProfileName: "openpixo-public", method: "azure-artifact-signing" });
    expect(key).not.toHaveProperty("certificateSha1");
    vi.stubEnv("PIXO_WIN_SIGN_AZURE_PROFILE", "openpixo-other");
    expect(resolveWinSigningCacheKey(config)).not.toEqual(key);
    expect(resolveWinSigningCacheKey({ signed: false } as ToolPackConfig)).toEqual({ enabled: false });
  });
});
