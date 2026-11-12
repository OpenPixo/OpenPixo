import { AGENT_SETUP_GUIDES, agentSetupGuide, type DoctorCheck, type DoctorResponse } from '@openpixo/contracts';

export const DOCTOR_PROBE_TIMEOUT_MS = 2_500;
export type DoctorEngineTool = 'godot' | 'node' | 'npm';
export interface DoctorAgentProbe {
  id: string;
  name: string;
  available: boolean;
  version?: string | null;
  authStatus?: string;
  installUrl?: string;
  probeError?: 'timeout' | 'failed';
}
export interface DoctorProbes {
  agents(): Promise<readonly DoctorAgentProbe[]>;
  engineTool(tool: DoctorEngineTool): Promise<{ available: boolean; configured: boolean }>;
  ffmpeg(): Promise<{ version?: string; source: 'configured' | 'bundled' }>;
  providers(): Promise<{ image: boolean; audio: boolean }>;
}

export class DoctorProbeTimeout extends Error {}
export class DoctorProbeMissing extends Error {}

/** Every local dependency has its own deadline, so one failed probe cannot hide the other groups. */
async function bounded<T>(probe: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(probe),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new DoctorProbeTimeout()), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Version output is untrusted process text; expose only a bounded version token. */
export function doctorVersion(value: string | null | undefined): string | undefined {
  return value?.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0]?.slice(0, 80);
}

function failure(check: DoctorCheck, caught: unknown): DoctorCheck {
  if (caught instanceof DoctorProbeMissing) return { ...check, status: 'missing', detail: { code: 'not-found' } };
  return { ...check, status: 'error', detail: { code: caught instanceof DoctorProbeTimeout ? 'probe-timeout' : 'probe-failed' } };
}

function agentCheck(agent: DoctorAgentProbe | undefined, id: string, name: string): DoctorCheck {
  const guide = agentSetupGuide(id);
  const check: DoctorCheck = {
    id: `agent:${id}`, group: 'agents', status: 'missing',
    title: { code: 'agent', params: { name } }, detail: { code: 'not-found' },
    fix: agent?.installUrl ? { kind: 'install-url', value: agent.installUrl }
      : { kind: 'command', value: guide?.installCommand ?? id },
  };
  if (agent?.probeError) return { ...check, status: 'error', detail: { code: agent.probeError === 'timeout' ? 'probe-timeout' : 'probe-failed' } };
  if (!agent?.available) return check;
  const version = doctorVersion(agent.version);
  const params = version ? { version } : undefined;
  if (agent.authStatus === 'ok') {
    return { ...check, status: 'ok', detail: { code: 'signed-in', ...(params ? { params } : {}) }, fix: { kind: 'settings', value: 'execution' } };
  }
  if (agent.authStatus === 'missing') {
    return { ...check, status: 'warn', detail: { code: 'sign-in-required', ...(params ? { params } : {}) },
      fix: { kind: 'command', value: guide?.signInCommand ?? id } };
  }
  if (agent.authStatus === undefined) return { ...check, status: 'ok', detail: { code: 'available', ...(params ? { params } : {}) }, fix: { kind: 'settings', value: 'execution' } };
  return { ...check, status: 'warn', detail: { code: 'auth-unknown', ...(params ? { params } : {}) }, fix: { kind: 'settings', value: 'execution' } };
}

/** A fresh, read-only report. Each group starts immediately and failures remain local to its checks. */
export async function checkEnvironment(probes: DoctorProbes, timeoutMs = DOCTOR_PROBE_TIMEOUT_MS): Promise<DoctorResponse> {
  const agents = bounded(() => probes.agents(), timeoutMs).then(
    result => AGENT_SETUP_GUIDES.map(guide => agentCheck(result.find(agent => agent.id === guide.id), guide.id, guide.name)),
    caught => AGENT_SETUP_GUIDES.map(guide => failure(agentCheck(undefined, guide.id, guide.name), caught)),
  );
  const engines = (['godot', 'node', 'npm'] as const).map(async tool => {
    const check: DoctorCheck = { id: `engine:${tool}`, group: 'engines', status: 'missing', title: { code: tool },
      detail: { code: 'not-found' }, fix: { kind: 'install-url', value: tool === 'godot' ? 'https://godotengine.org/download' : 'https://nodejs.org' } };
    try {
      const result = await bounded(() => probes.engineTool(tool), timeoutMs);
      return { ...check, status: result.available ? 'ok' : 'missing',
        detail: { code: result.available ? 'available' : result.configured ? 'invalid-path' : 'not-found',
          params: { source: result.configured ? 'configured' : 'path' } },
        ...(result.configured ? { fix: { kind: 'settings', value: 'gameEngines' } } : {}) } as DoctorCheck;
    } catch (caught) { return failure(check, caught); }
  });
  const ffmpegCheck: DoctorCheck = { id: 'media:ffmpeg', group: 'media-tools', status: 'missing', title: { code: 'ffmpeg' },
    detail: { code: 'not-found' }, fix: { kind: 'install-url', value: 'https://ffmpeg.org/download.html' } };
  const ffmpeg = bounded(() => probes.ffmpeg(), timeoutMs).then(result => {
    const version = doctorVersion(result.version);
    return { ...ffmpegCheck, status: 'ok', detail: { code: 'available', params: { source: result.source, ...(version ? { version } : {}) } } } as DoctorCheck;
  }, caught => failure(ffmpegCheck, caught));
  const providerChecks: DoctorCheck[] = (['image', 'audio'] as const).map(kind => ({
    id: `provider:${kind}`, group: 'providers', status: 'missing', title: { code: `${kind}-provider` },
    detail: { code: 'not-configured', params: { configured: false } }, fix: { kind: 'settings', value: 'media' },
  }));
  const providers = bounded(() => probes.providers(), timeoutMs).then(result => providerChecks.map((check, index) => {
    const configured = index === 0 ? result.image : result.audio;
    return { ...check, status: configured ? 'ok' : 'missing', detail: { code: configured ? 'configured' : 'not-configured', params: { configured } } } as DoctorCheck;
  }), caught => providerChecks.map(check => failure(check, caught)));
  const [agentResults, engineResults, ffmpegResult, providerResults] = await Promise.all([agents, Promise.all(engines), ffmpeg, providers]);
  return { checks: [...agentResults, ...engineResults, ffmpegResult, ...providerResults] };
}
