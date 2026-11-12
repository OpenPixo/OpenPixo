import type { EngineProfileResponse } from '@openpixo/contracts';

/** Thin client shared by the project CLI dispatcher; execution stays out of detection. */
export async function printProjectEngine(
  base: string,
  id: string,
  options: { refresh?: boolean; json?: boolean; headers?: Record<string, string> },
): Promise<void> {
  const response = await fetch(`${base}/api/projects/${encodeURIComponent(id)}/engine${options.refresh ? '/refresh' : ''}`, {
    method: options.refresh ? 'POST' : 'GET',
    headers: { ...options.headers, Origin: new URL(base).origin },
  });
  const data = await response.json() as EngineProfileResponse & { error?: { message?: string } };
  if (!response.ok) {
    process.stderr.write(`${JSON.stringify(data)}\n`);
    process.exitCode = 1;
    return;
  }
  if (options.json) { process.stdout.write(`${JSON.stringify(data, null, 2)}\n`); return; }
  const { profile } = data;
  console.log(`${profile.engine}${profile.engineVersion ? ` ${profile.engineVersion}` : ''} (${profile.confidence})`);
  console.log(`Evidence: ${profile.evidence.join(', ') || '-'}`);
  for (const tool of profile.tools) console.log(`${tool.id}: ${tool.resolved ? 'resolved' : 'missing'}${tool.source ? ` (${tool.source})` : ''}`);
  for (const [step, reason] of Object.entries(profile.unavailableReasons ?? {})) console.log(`${step}: unavailable — ${reason}`);
}
