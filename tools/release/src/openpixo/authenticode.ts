import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AuthenticodeResult = {
  /** True only when Windows reports the signature chain as `Valid`. */
  signed: boolean;
  /** `Get-AuthenticodeSignature` status, or `NotSigned` when the PE carries no certificate table. */
  status: string;
  signer?: string;
};

export type AuthenticodeVerifier = (path: string) => Promise<AuthenticodeResult>;

const IMAGE_DIRECTORY_ENTRY_SECURITY = 4;

/**
 * Reads the PE header and reports whether the image carries an Authenticode
 * certificate table. Presence is not validity; it only lets non-Windows hosts
 * tell an obviously unsigned installer apart.
 */
export async function hasEmbeddedSignature(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const read = async (position: number, length: number): Promise<Buffer | null> => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      return bytesRead === length ? buffer : null;
    };
    const dos = await read(0, 64);
    if (dos == null || dos.readUInt16LE(0) !== 0x5a4d) return false;
    const peOffset = dos.readUInt32LE(0x3c);
    const header = await read(peOffset, 24 + 2);
    if (header == null || header.readUInt32LE(0) !== 0x00004550) return false;
    const optionalOffset = peOffset + 24;
    const magic = header.readUInt16LE(24);
    const directoriesOffset = optionalOffset + (magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1);
    if (directoriesOffset < optionalOffset) return false;
    const entry = await read(directoriesOffset + IMAGE_DIRECTORY_ENTRY_SECURITY * 8, 8);
    return entry != null && entry.readUInt32LE(0) > 0 && entry.readUInt32LE(4) > 0;
  } finally {
    await handle.close();
  }
}

/**
 * Validates the Authenticode chain with Windows' own policy. Off Windows the
 * chain cannot be checked, so an embedded signature reports `Unverified` and
 * still counts as unsigned for publication.
 */
export async function verifyAuthenticode(path: string): Promise<AuthenticodeResult> {
  if (!await hasEmbeddedSignature(path)) return { signed: false, status: "NotSigned" };
  if (process.platform !== "win32") return { signed: false, status: "Unverified" };
  const script = "$s = Get-AuthenticodeSignature -LiteralPath $env:OPENPIXO_AUTHENTICODE_PATH; "
    + "[pscustomobject]@{ status = [string]$s.Status; signer = [string]$s.SignerCertificate.Subject } | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { env: { ...process.env, OPENPIXO_AUTHENTICODE_PATH: path }, windowsHide: true },
  );
  const parsed = JSON.parse(stdout) as { signer?: string; status?: string };
  const status = parsed.status || "Unknown";
  return { signed: status === "Valid", status, ...(parsed.signer ? { signer: parsed.signer } : {}) };
}
