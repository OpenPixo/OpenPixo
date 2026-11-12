import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import type { ToolPackConfig } from "../config/index.js";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMESTAMP_URL = "http://timestamp.digicert.com";
// Artifact Signing (formerly Trusted Signing) certificates live for days, so
// every signature must carry this service's RFC 3161 timestamp to stay valid.
const AZURE_ARTIFACT_SIGNING_TIMESTAMP_URL = "http://timestamp.acs.microsoft.com";
const DEFAULT_SIGNTOOL_CANDIDATES = [
  "signtool.exe",
  "C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.26100.0\\x64\\signtool.exe",
  "C:\\Program Files (x86)\\Windows Kits\\10\\App Certification Kit\\signtool.exe",
];

type WinSigningCommon = {
  digestAlgorithm: "sha256";
  signtoolPath: string;
  timestampAlgorithm: "sha256";
  timestampUrl: string;
};

/** A certificate already in the Windows store (for example an imported PFX), selected by thumbprint. */
export type WinCertificateSigningConfig = WinSigningCommon & {
  certificateSha1: string;
  method: "certificate";
};

/**
 * Azure Artifact Signing through signtool's dlib extension. The dlib
 * authenticates with Azure's DefaultAzureCredential chain (service principal
 * env vars, workload identity, or an Azure CLI login); no key material is
 * read here.
 */
export type WinAzureArtifactSigningConfig = WinSigningCommon & {
  accountName: string;
  certificateProfileName: string;
  correlationId?: string;
  dlibPath: string;
  endpoint: string;
  method: "azure-artifact-signing";
};

export type WinSigningConfig = WinCertificateSigningConfig | WinAzureArtifactSigningConfig;

export type WinSigningCacheKey = {
  accountName?: string;
  certificateProfileName?: string;
  certificateSha1?: string;
  digestAlgorithm?: string;
  enabled: boolean;
  endpoint?: string;
  method?: "azure-artifact-signing";
  timestampAlgorithm?: string;
  timestampUrl?: string;
};

export type WinSigningDetails = {
  args: string[];
  command: string;
  file: string;
  stderrBytes: number;
  stderrTail: string;
  stdoutBytes: number;
  stdoutTail: string;
  verifyArgs: string[];
  verifyStderrBytes: number;
  verifyStderrTail: string;
  verifyStdoutBytes: number;
  verifyStdoutTail: string;
};

export type WinSigningOptions = {
  verify?: boolean;
};

export function resolveWinSigningCacheKey(config: ToolPackConfig): WinSigningCacheKey {
  if (!config.signed) return { enabled: false };
  const signing = resolveWinSigningConfig();
  const shared = {
    digestAlgorithm: signing.digestAlgorithm,
    enabled: true,
    timestampAlgorithm: signing.timestampAlgorithm,
    timestampUrl: signing.timestampUrl,
  };
  // The Artifact Signing certificate rotates daily; its stable identity is the
  // account + certificate profile, never a thumbprint.
  return signing.method === "certificate"
    ? { certificateSha1: signing.certificateSha1, ...shared }
    : {
        accountName: signing.accountName,
        certificateProfileName: signing.certificateProfileName,
        endpoint: signing.endpoint,
        method: signing.method,
        ...shared,
      };
}

/**
 * Selects the signing method. `PIXO_WIN_SIGN_METHOD` is explicit; otherwise an
 * Artifact Signing account selects Azure, and anything else falls back to the
 * certificate-thumbprint path.
 */
export function resolveWinSigningConfig(env: NodeJS.ProcessEnv = process.env): WinSigningConfig {
  const method = env.PIXO_WIN_SIGN_METHOD?.trim()
    || (env.PIXO_WIN_SIGN_AZURE_ACCOUNT?.trim() ? "azure-artifact-signing" : "certificate");
  const signtoolPath = env.PIXO_WIN_SIGNTOOL_PATH ?? env.WIN_SIGNTOOL_PATH ?? DEFAULT_SIGNTOOL_CANDIDATES[0];
  const explicitTimestampUrl = env.PIXO_WIN_SIGN_TIMESTAMP_URL ?? env.WIN_SIGN_TIMESTAMP_URL;
  if (method === "azure-artifact-signing") {
    return {
      ...resolveAzureArtifactSigning(env),
      digestAlgorithm: "sha256",
      method,
      signtoolPath,
      timestampAlgorithm: "sha256",
      timestampUrl: explicitTimestampUrl ?? AZURE_ARTIFACT_SIGNING_TIMESTAMP_URL,
    };
  }
  if (method !== "certificate") {
    throw new Error(`PIXO_WIN_SIGN_METHOD must be certificate or azure-artifact-signing, got ${method}`);
  }
  const certificateSha1 = normalizeSha1(env.PIXO_WIN_SIGN_CERT_SHA1 ?? env.WIN_SIGN_CERT_SHA1);
  if (certificateSha1 == null) {
    throw new Error(
      "signed Windows builds require PIXO_WIN_SIGN_CERT_SHA1 (certificate) or PIXO_WIN_SIGN_AZURE_* (Azure Artifact Signing)",
    );
  }
  return {
    certificateSha1,
    digestAlgorithm: "sha256",
    method: "certificate",
    signtoolPath,
    timestampAlgorithm: "sha256",
    timestampUrl: explicitTimestampUrl ?? DEFAULT_TIMESTAMP_URL,
  };
}

function resolveAzureArtifactSigning(
  env: NodeJS.ProcessEnv,
): Pick<WinAzureArtifactSigningConfig, "accountName" | "certificateProfileName" | "correlationId" | "dlibPath" | "endpoint"> {
  const value = (name: string): string => {
    const raw = env[name]?.trim();
    if (!raw) throw new Error(`Azure Artifact Signing requires ${name}`);
    return raw;
  };
  const endpoint = value("PIXO_WIN_SIGN_AZURE_ENDPOINT");
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new Error(`PIXO_WIN_SIGN_AZURE_ENDPOINT must be an absolute URL: ${endpoint}`);
  }
  if (
    endpointUrl.protocol !== "https:" ||
    !endpointUrl.hostname.endsWith(".codesigning.azure.net") ||
    endpointUrl.pathname !== "/" ||
    endpointUrl.search !== "" ||
    endpointUrl.username !== ""
  ) {
    throw new Error(
      "PIXO_WIN_SIGN_AZURE_ENDPOINT must be the signing account's regional https://<region>.codesigning.azure.net endpoint",
    );
  }
  const dlibPath = value("PIXO_WIN_SIGN_AZURE_DLIB");
  if (!isAbsolute(dlibPath)) {
    throw new Error("PIXO_WIN_SIGN_AZURE_DLIB must be the absolute path of the x64 Azure.CodeSigning.Dlib.dll");
  }
  const correlationId = env.PIXO_WIN_SIGN_AZURE_CORRELATION_ID?.trim();
  return {
    accountName: value("PIXO_WIN_SIGN_AZURE_ACCOUNT"),
    certificateProfileName: value("PIXO_WIN_SIGN_AZURE_PROFILE"),
    ...(correlationId ? { correlationId } : {}),
    dlibPath,
    endpoint: endpointUrl.origin,
  };
}

/** The `/dmdf` document the Artifact Signing dlib reads. */
export function azureArtifactSigningMetadata(signing: WinAzureArtifactSigningConfig): Record<string, string> {
  return {
    CertificateProfileName: signing.certificateProfileName,
    CodeSigningAccountName: signing.accountName,
    ...(signing.correlationId == null ? {} : { CorrelationId: signing.correlationId }),
    Endpoint: signing.endpoint,
  };
}

/** signtool `sign` argv; `metadataPath` is the `/dmdf` file Artifact Signing requires. */
export function winSignArgs(signing: WinSigningConfig, file: string, metadataPath?: string): string[] {
  const shared = ["/fd", signing.digestAlgorithm, "/tr", signing.timestampUrl, "/td", signing.timestampAlgorithm];
  if (signing.method === "certificate") return ["sign", "/sha1", signing.certificateSha1, ...shared, file];
  if (metadataPath == null) throw new Error("Azure Artifact Signing requires a dlib metadata file");
  return ["sign", "/v", ...shared, "/dlib", signing.dlibPath, "/dmdf", metadataPath, file];
}

export async function signAndVerifyWinFile(
  file: string,
  options: WinSigningOptions = {},
): Promise<WinSigningDetails> {
  const signing = resolveWinSigningConfig();
  const signtoolPath = await resolveSigntoolPath(signing.signtoolPath);
  const verify = options.verify !== false;
  let metadataRoot: string | null = null;
  let args: string[];
  let result: { stderr: string; stdout: string };
  try {
    let metadataPath: string | undefined;
    if (signing.method === "azure-artifact-signing") {
      metadataRoot = await mkdtemp(join(tmpdir(), "openpixo-artifact-signing-"));
      metadataPath = join(metadataRoot, "metadata.json");
      await writeFile(metadataPath, `${JSON.stringify(azureArtifactSigningMetadata(signing), null, 2)}\n`, "utf8");
    }
    args = winSignArgs(signing, file, metadataPath);
    result = await execFileAsync(signtoolPath, args, { windowsHide: true });
  } finally {
    if (metadataRoot != null) await rm(metadataRoot, { force: true, recursive: true });
  }
  const verifyArgs = verify ? ["verify", "/pa", "/v", file] : [];
  const verifyResult = verify
    ? await execFileAsync(signtoolPath, verifyArgs, { windowsHide: true })
    : { stderr: "", stdout: "" };
  return {
    args,
    command: signtoolPath,
    file,
    stderrBytes: result.stderr.length,
    stderrTail: result.stderr.slice(-2000),
    stdoutBytes: result.stdout.length,
    stdoutTail: result.stdout.slice(-2000),
    verifyArgs,
    verifyStderrBytes: verifyResult.stderr.length,
    verifyStderrTail: verifyResult.stderr.slice(-2000),
    verifyStdoutBytes: verifyResult.stdout.length,
    verifyStdoutTail: verifyResult.stdout.slice(-2000),
  };
}

export async function resolveSigntoolPath(
  configured: string,
  candidates: readonly string[] = DEFAULT_SIGNTOOL_CANDIDATES,
): Promise<string> {
  const filesystemCandidates = candidates.filter((candidate) => candidate !== "signtool.exe");
  const orderedFilesystemCandidates = configured === "signtool.exe"
    ? filesystemCandidates
    : [configured, ...filesystemCandidates.filter((candidate) => candidate !== configured)];

  for (const candidate of orderedFilesystemCandidates) {
    if (await fileExists(candidate)) return candidate;
  }

  return configured === "signtool.exe" && candidates.includes("signtool.exe")
    ? "signtool.exe"
    : configured;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeSha1(value: string | undefined): string | null {
  if (value == null) return null;
  const normalized = value.replace(/\s/g, "").toUpperCase();
  if (normalized.length === 0) return null;
  if (!/^[0-9A-F]{40}$/.test(normalized)) {
    throw new Error("PIXO_WIN_SIGN_CERT_SHA1 must be a 40-character SHA1 thumbprint");
  }
  return normalized;
}
