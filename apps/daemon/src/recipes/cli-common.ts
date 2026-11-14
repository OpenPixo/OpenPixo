import { readFile } from 'node:fs/promises';
import { resolveDaemonUrl } from '../daemon-url.js';

export async function recipeCliText(file: string): Promise<string> {
  if (file !== '-') return readFile(file, 'utf8');
  process.stdin.setEncoding('utf8');
  let result = '';
  for await (const chunk of process.stdin) result += String(chunk);
  return result;
}
export function parseRecipeInputs(text: string, overrides: string[] = []): Record<string, unknown> {
  const result: unknown = JSON.parse(text);
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Inputs must be a JSON object');
  const inputs = { ...result } as Record<string, unknown>;
  for (const assignment of overrides) {
    const at = assignment.indexOf('=');
    if (at < 1) throw new Error('--input expects k=v');
    const key = assignment.slice(0, at);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) throw new Error('Invalid input name');
    Object.defineProperty(inputs, key, { value: assignment.slice(at + 1), enumerable: true, writable: true, configurable: true });
  }
  return inputs;
}
export async function recipeCliApi(flagUrl?: string): Promise<(route: string, method?: string, body?: unknown) => Promise<unknown>> {
  const base = (await resolveDaemonUrl({ flagUrl: flagUrl ?? null })).replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: new URL(base).origin };
  if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
  return async (route, method = 'GET', body) => {
    const response = await fetch(`${base}${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json() as { error?: { message?: string }; missingSkills?: string[] };
    if (!response.ok) throw new Error(data.error?.message ?? (data.missingSkills?.length ? `Enable required project skills: ${data.missingSkills.join(', ')}` : `Request failed (${response.status})`));
    return data;
  };
}
/** Sends one file as multipart `file`, the way the 生成 page uploads a reference picture. */
export async function recipeCliUpload(flagUrl: string | undefined, route: string, bytes: Buffer, name: string): Promise<unknown> {
  const base = (await resolveDaemonUrl({ flagUrl: flagUrl ?? null })).replace(/\/$/, '');
  const headers: Record<string, string> = { Origin: new URL(base).origin };
  if (process.env.PIXO_TOOL_TOKEN) headers.authorization = `Bearer ${process.env.PIXO_TOOL_TOKEN}`;
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)]), name);
  const response = await fetch(`${base}${route}`, { method: 'POST', headers, body: form });
  const data = await response.json() as { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? `Request failed (${response.status})`);
  return data;
}
export function recipeCliError(error: unknown, json: boolean): void {
  const message = error instanceof Error ? error.message : String(error);
  if (json) console.log(JSON.stringify({ error: { message } })); else console.error(message);
  process.exitCode = 5;
}
