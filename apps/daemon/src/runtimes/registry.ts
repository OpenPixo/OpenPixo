import { claudeAgentDef } from './defs/claude.js';
import { codexAgentDef } from './defs/codex.js';
import { opencodeAgentDef } from './defs/opencode.js';
import { byokOpenCodeAgentDef } from './defs/byok-opencode.js';
import { openpixoAgentDef } from './defs/openpixo-agent.js';
import type { RuntimeAgentDef } from './types.js';

/** Certified runtime adapters shipped by this build. */
export const SHIPPED_AGENT_DEFS: RuntimeAgentDef[] = [
  claudeAgentDef,
  codexAgentDef,
  opencodeAgentDef,
  byokOpenCodeAgentDef,
  openpixoAgentDef,
];

export const AGENT_DEFS: RuntimeAgentDef[] = [...SHIPPED_AGENT_DEFS];

const ids = new Set();
for (const def of AGENT_DEFS) {
  if (ids.has(def.id)) {
    throw new Error(`Duplicate agent definition id: ${def.id}`);
  }
  ids.add(def.id);
}

export function getAgentDef(id: string): RuntimeAgentDef | null {
  return AGENT_DEFS.find((a) => a.id === id) || null;
}
