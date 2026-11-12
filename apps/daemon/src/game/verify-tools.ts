import type { GameVerifyToolGuidance } from '@openpixo/contracts';

const TOOLS: Record<string, { name: string; installUrl: string; configuration: GameVerifyToolGuidance['configuration'] }> = {
  godot: { name: 'Godot', installUrl: 'https://godotengine.org/download', configuration: 'engine-settings' },
  unity: { name: 'Unity', installUrl: 'https://unity.com/download', configuration: 'engine-settings' },
  cocosCreator: { name: 'Cocos Creator', installUrl: 'https://www.cocos.com/creator', configuration: 'engine-settings' },
  npm: { name: 'Node.js (npm)', installUrl: 'https://nodejs.org', configuration: 'path' },
  pnpm: { name: 'pnpm', installUrl: 'https://pnpm.io/installation', configuration: 'path' },
  yarn: { name: 'Yarn', installUrl: 'https://yarnpkg.com/getting-started/install', configuration: 'path' },
  cargo: { name: 'Rust (Cargo)', installUrl: 'https://rust-lang.org/tools/install', configuration: 'path' },
};

/** Rebuild trusted guidance from logical tool ids at both execution and registration boundaries. */
export function missingGameToolGuidance(tools: string[]): GameVerifyToolGuidance[] {
  return tools.map(tool => {
    const known = Object.hasOwn(TOOLS, tool) ? TOOLS[tool] : undefined;
    const name = known?.name ?? tool;
    const configuration = known?.configuration ?? 'path';
    return {
      tool, name, configuration,
      ...(known ? { installUrl: known.installUrl } : {}),
      hint: `Could not find ${name} (${tool}). Install it, then ${configuration === 'engine-settings'
        ? 'set the executable path in game engine settings and verify again.'
        : 'make sure the tool is on PATH, restart OpenPixo and verify again.'}`,
    };
  });
}
