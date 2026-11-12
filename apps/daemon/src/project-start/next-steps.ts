import type {
  DoctorCheck, DoctorResponse, EngineProfile, GameVerifyResult, ProjectMetadata,
  ProjectNextStepsResponse, ProjectNextStepStatus,
} from '@openpixo/contracts';

export interface ProjectStarterFacts {
  profile: EngineProfile;
  doctor: DoctorResponse;
  hasSucceededAgentRun: boolean;
  mediaAssetCount: number;
  latestVerify: GameVerifyResult | null;
}

/** A completion marker is never stored: every step follows the current evidence. */
export function deriveProjectNextSteps(projectId: string, metadata: ProjectMetadata | undefined, facts: ProjectStarterFacts): ProjectNextStepsResponse {
  const { profile, latestVerify } = facts;
  const web = ['phaser', 'threejs'].includes(profile.engine);
  const requiredChecks = new Set(profile.tools.map(tool => `engine:${tool.id}`));
  if (profile.engine === 'godot') requiredChecks.add('engine:godot');
  if (web || profile.engine === 'web-generic') requiredChecks.add('engine:node');
  const relevant = facts.doctor.checks.filter(check => requiredChecks.has(check.id));
  const doctorStatus = (id: string): DoctorCheck['status'] | undefined => facts.doctor.checks.find(check => check.id === `engine:${id}`)?.status;
  const toolsReady = profile.tools.every(tool => {
    const checked = doctorStatus(tool.id);
    return checked === undefined ? tool.resolved : checked === 'ok';
  });
  const knownEnvironment = profile.engine !== 'unknown' && (relevant.length > 0 || profile.tools.length > 0);
  const ready = knownEnvironment && toolsReady && relevant.every(check => check.status === 'ok');
  const environment: ProjectNextStepStatus = ready ? 'done'
    : !knownEnvironment || relevant.some(check => check.status === 'error') ? 'blocked' : 'todo';
  const canRun = ready && (profile.engine === 'godot' || web)
    && Boolean(profile.commands.run ?? (profile.engine === 'godot' ? profile.commands.check : undefined));
  const canVerify = ready && Object.values(profile.commands).some(Boolean);
  const ran = Number.isFinite(metadata?.gameRunSucceededAt) || latestVerify?.steps.some(step => step.name === 'run' && !step.timedOut
    && (step.status === 'passed' || step.status === undefined && step.exitCode === 0)) === true;
  const firstTask = profile.engine === 'unknown'
    ? 'Inspect this game project, identify its engine, and suggest one small playable improvement. Ask before changing files.'
    : `Inspect this ${profile.engine} game project and implement one small playable improvement. Keep the change focused and explain how to test it.`;
  return {
    projectId, engine: profile.engine, dismissed: metadata?.starterChecklistDismissed === true,
    steps: [
      { id: 'environment', status: environment, action: { kind: 'open-settings', value: 'environment' } },
      { id: 'run-game', status: ran ? 'done' : canRun ? 'todo' : 'blocked', action: { kind: 'run-game', value: projectId } },
      { id: 'agent-task', status: facts.hasSucceededAgentRun ? 'done' : 'todo', action: { kind: 'prefill-chat', value: firstTask } },
      { id: 'media-assets', status: facts.mediaAssetCount > 0 ? 'done' : 'todo', action: { kind: 'open-tab', value: facts.mediaAssetCount > 0 ? 'assets' : 'generate' } },
      { id: 'verify', status: latestVerify?.status === 'passed' ? 'done' : canVerify ? 'todo' : 'blocked', action: { kind: 'verify', value: projectId } },
    ],
  };
}
