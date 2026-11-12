import { spawn } from 'node:child_process';
import { readAppConfigSync } from '../app-config.js';
import { ffmpegPath } from '../assets/ops/audio.js';
import { gameToolResolver } from '../game/verify.js';
import { readMaskedConfig } from '../media/config.js';
import { AUDIO_MODELS_BY_KIND, IMAGE_MODELS, MEDIA_PROVIDERS } from '../media/models.js';
import { detectAgentsReadiness } from '../runtimes/detection.js';
import { DoctorProbeMissing, DoctorProbeTimeout, type DoctorProbes } from './checks.js';

const PROCESS_TIMEOUT_MS = 1_500;

/** Use the asset processor's executable, with a short cancellable version-only probe. */
export function probeDoctorFfmpeg(): ReturnType<DoctorProbes['ffmpeg']> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else {
        const version = output.split(/\r?\n/)[0];
        resolve({ ...(version ? { version } : {}), source: process.env.HYPERFRAMES_FFMPEG_PATH?.trim() ? 'configured' : 'bundled' });
      }
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new DoctorProbeTimeout()); }, PROCESS_TIMEOUT_MS);
    child.stdout.on('data', chunk => { output = `${output}${String(chunk)}`.slice(0, 4_096); });
    child.stderr.resume();
    child.once('error', error => finish((error as NodeJS.ErrnoException).code === 'ENOENT' ? new DoctorProbeMissing() : error));
    child.once('close', code => finish(code === 0 && output.startsWith('ffmpeg version') ? undefined : new Error('FFmpeg version unavailable')));
  });
}

/** Data-root ownership stays with the daemon; this module only reads existing settings. */
export function createDoctorProbes(dataDir: string, projectRoot: string): DoctorProbes {
  // The sync reader shares normal validation and skips the async reader's installation migration write.
  const config = Promise.resolve().then(() => readAppConfigSync(dataDir));
  return {
    agents: async () => detectAgentsReadiness((await config).agentCliEnv ?? {}, PROCESS_TIMEOUT_MS),
    engineTool: async tool => {
      const paths = (await config).gameEnginePaths ?? {};
      return { available: gameToolResolver({ ...paths })(tool) !== null,
        configured: tool === 'godot' && Boolean(paths.godot?.trim()) };
    },
    ffmpeg: probeDoctorFfmpeg,
    providers: async () => {
      const masked = await readMaskedConfig(projectRoot, { dataDir, refreshCredentials: false });
      const enabled = new Set(MEDIA_PROVIDERS.filter(provider => provider.integrated && provider.id !== 'stub').map(provider => provider.id));
      const configured = (provider: string) => enabled.has(provider) && (masked.providers[provider]?.configured === true
        || provider === 'custom-image' && Boolean(masked.providers[provider]?.baseUrl.trim() && masked.providers[provider]?.model?.trim()));
      return { image: IMAGE_MODELS.some(model => configured(model.provider)),
        audio: Object.values(AUDIO_MODELS_BY_KIND).flat().some(model => configured(model.provider)) };
    },
  };
}
