import { fetchOpenPixoAgentModels, OPENPIXO_AGENT_FALLBACK_MODELS, openpixoAgentModelArg } from '../../openpixo-agent/runtime.js';
import {
  OPENCODE_PERMISSION_CAPABILITY,
  appendOpenCodePermissionBypass,
} from '../opencode-permissions.js';
import type { RuntimeAgentDef } from '../types.js';

/**
 * The bundled OpenCode on the OpenPixo-credits model: no API key, paid per token
 * from the signed-in account through the daemon's local gateway.
 */
export const openpixoAgentDef = {
  id: 'openpixo-agent',
  name: 'OpenPixo',
  bin: 'opencode-cli',
  fallbackBins: ['opencode'],
  versionArgs: ['--version'],
  ...OPENCODE_PERMISSION_CAPABILITY,
  // The cloud decides what is on offer; the list here is for when it cannot be asked.
  fallbackModels: OPENPIXO_AGENT_FALLBACK_MODELS,
  fetchModels: fetchOpenPixoAgentModels,
  buildArgs: (_prompt, _imagePaths, _extra, options = {}, runtimeContext = {}) => {
    const args = ['run', '--format', 'json'];
    if (typeof runtimeContext.cwd === 'string' && runtimeContext.cwd.length > 0) {
      // Same reason as byok-opencode: keep Write/Edit inside the selected project.
      args.push('--dir', runtimeContext.cwd);
    }
    appendOpenCodePermissionBypass(args, 'openpixo-agent');
    if (typeof runtimeContext.resumeSessionId === 'string' && runtimeContext.resumeSessionId.length > 0) {
      args.push('-s', runtimeContext.resumeSessionId);
    }
    args.push('-m', openpixoAgentModelArg(options.model));
    return args;
  },
  promptViaStdin: true,
  // Continuing the session keeps every request opening with what the last one sent, which is
  // all a vendor's prompt cache can reuse. A new session each turn wrote the whole prompt again:
  // about 12 credits on GPT-6.1 Sol, even for a one-word answer.
  resumesSessionViaCli: true,
  capturesSessionIdFromStream: true,
  streamFormat: 'json-event-stream',
  eventParser: 'opencode',
  externalMcpInjection: 'opencode-env-content',
  extensionInjector: 'opencode-config-content',
} satisfies RuntimeAgentDef;
