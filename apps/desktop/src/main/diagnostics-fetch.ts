import { DIAGNOSTICS_EXPORT_PATH } from "@openpixo/diagnostics";

export interface FetchDiagnosticsBundleDeps {
  /** Fetch the daemon-owned diagnostic bundle. Data paths follow root AGENTS.md. */
  fetchImpl?: typeof fetch;
}

export async function fetchDiagnosticsBundle(
  baseUrl: string,
  deps: FetchDiagnosticsBundleDeps = {},
): Promise<Buffer> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = new URL(DIAGNOSTICS_EXPORT_PATH, baseUrl).toString();
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`GET ${DIAGNOSTICS_EXPORT_PATH} failed with HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
