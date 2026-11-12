import { PRODUCT_CLI_NAME } from '../product.js';
import type { CapabilityCell, RuntimeCapabilityMatrix } from '../api/agent-capabilities.js';

export const CAPABILITY_CELLS = [
  'project-skills', 'project-mcp', 'global-mcp', 'approvals',
  'interrupt', 'resume', 'steer', 'sub-agents', 'image-input',
  'media-cli', 'game-verify', 'plan-mode',
] as const satisfies readonly CapabilityCell[];

export const RUNTIME_CAPABILITY_MATRIX = {
  codex: {
    'project-skills': { state: 'implemented', evidence: 'apps/daemon/src/server.ts (projectExtensions.skills)' },
    'project-mcp': { state: 'implemented', evidence: 'apps/daemon/src/runtimes/extension-injection.ts' },
    'global-mcp': { state: 'implemented', evidence: 'apps/daemon/src/runtimes/extension-injection.ts' },
    approvals: { state: 'implemented', evidence: 'apps/daemon/tests/codex-approval-routes.test.ts' },
    interrupt: { state: 'implemented', evidence: 'apps/daemon/src/runtimes/runs.ts' },
    resume: { state: 'implemented', evidence: 'apps/daemon/tests/runtimes/codex-resume-args.test.ts' },
    steer: { state: 'unsupported', note: 'Mid-turn input requires stream-json stdin.' },
    'sub-agents': { state: 'implemented', evidence: 'apps/daemon/tests/runtimes/codex-child-evidence.test.ts' },
    'image-input': { state: 'unknown' },
    'media-cli': { state: 'implemented', evidence: `apps/daemon/src/cli.ts (${PRODUCT_CLI_NAME} media)` },
    'game-verify': { state: 'implemented', evidence: 'apps/daemon/src/game/verify-cli.ts' },
    'plan-mode': { state: 'unknown' },
  },
  claude: {
    'project-skills': { state: 'implemented', evidence: 'apps/daemon/src/server.ts (projectExtensions.skills)' },
    'project-mcp': { state: 'implemented', evidence: 'apps/daemon/src/runtimes/extension-injection.ts' },
    'global-mcp': { state: 'implemented', evidence: 'apps/daemon/src/runtimes/extension-injection.ts' },
    approvals: { state: 'implemented', evidence: 'apps/daemon/tests/claude-approvals.test.ts' },
    interrupt: { state: 'implemented', evidence: 'apps/daemon/src/runtimes/runs.ts' },
    resume: { state: 'implemented', evidence: 'apps/daemon/tests/runtimes/claude-resume-args.test.ts' },
    steer: { state: 'implemented', evidence: 'apps/daemon/tests/run-steering.test.ts' },
    'sub-agents': { state: 'implemented', evidence: 'apps/daemon/tests/runtimes/claude-child-evidence.test.ts' },
    'image-input': { state: 'unknown' },
    'media-cli': { state: 'implemented', evidence: `apps/daemon/src/cli.ts (${PRODUCT_CLI_NAME} media)` },
    'game-verify': { state: 'implemented', evidence: 'apps/daemon/src/game/verify-cli.ts' },
    'plan-mode': { state: 'unknown' },
  },
  opencode: {
    'project-skills': { state: 'implemented', evidence: 'apps/daemon/src/server.ts (projectExtensions.skills)' },
    'project-mcp': { state: 'implemented', evidence: 'apps/daemon/src/runtimes/extension-injection.ts' },
    'global-mcp': { state: 'implemented', evidence: 'apps/daemon/src/runtimes/extension-injection.ts' },
    approvals: {
      state: 'unsupported',
      testedVersion: 'opencode 1.18.34',
      note: 'opencode run auto-rejects ask permissions; plugin permission.ask hook is never invoked. Runs with --auto.',
    },
    interrupt: { state: 'implemented', evidence: 'apps/daemon/src/runtimes/runs.ts' },
    resume: { state: 'implemented', evidence: 'apps/daemon/tests/runtimes/opencode-resume-args.test.ts' },
    steer: { state: 'unsupported', note: 'Mid-turn input requires stream-json stdin.' },
    'sub-agents': { state: 'implemented', evidence: 'apps/daemon/tests/runtimes/opencode-child-evidence.test.ts' },
    'image-input': { state: 'unknown' },
    'media-cli': { state: 'implemented', evidence: `apps/daemon/src/cli.ts (${PRODUCT_CLI_NAME} media)` },
    'game-verify': { state: 'implemented', evidence: 'apps/daemon/src/game/verify-cli.ts' },
    'plan-mode': { state: 'unknown' },
  },
} satisfies RuntimeCapabilityMatrix;
