import { describe, expect, it } from 'vitest';
import {
  composeOpenPixoGamePrompt,
  GAME_CLOUD_TOOLS_BLOCK_HEADING,
  GAME_MEDIA_CONTRACT_HEADING,
  GAME_SHAPE_BLOCK_HEADING,
  renderCloudToolsBlock,
} from '../src/prompts/openpixo-game.js';
import type { CloudToolInfo } from '../src/api/cloud-skills.js';

const TOOLS: CloudToolInfo[] = [
  { id: 'look', description: 'Answers one question about one image.', input: 'image' },
  { id: 'ui-review', description: 'Reviews a HUD screenshot for unreadable or cut-off text.', input: 'image' },
  { id: 'balance-check', description: 'Checks a balance table for runaway numbers.', input: 'text' },
];

describe('cloud tools in the game prompt', () => {
  it('lists each tool on one sorted line after the game shape, leaving look to its own block', () => {
    const prompt = composeOpenPixoGamePrompt({ cloudTools: TOOLS });
    const at = prompt.indexOf(GAME_CLOUD_TOOLS_BLOCK_HEADING);
    expect(at).toBeGreaterThan(prompt.indexOf(GAME_SHAPE_BLOCK_HEADING));
    expect(at).toBeLessThan(prompt.indexOf(GAME_MEDIA_CONTRACT_HEADING));
    const block = renderCloudToolsBlock(TOOLS);
    expect(block).toContain('"$PIXO_NODE_BIN" "$PIXO_BIN" tool <id> --question');
    const lines = block.split('\n').filter((line) => line.startsWith('- '));
    expect(lines).toEqual([
      '- `balance-check` (text): Checks a balance table for runaway numbers.',
      '- `ui-review` (image): Reviews a HUD screenshot for unreadable or cut-off text.',
    ]);
    // The order the cloud sent does not move the prompt, so the cache holds.
    expect(renderCloudToolsBlock([...TOOLS].reverse())).toBe(block);
  });

  it('leaves the prompt unchanged with no tools, only look, or a text-only provider', () => {
    const prompt = composeOpenPixoGamePrompt({});
    expect(composeOpenPixoGamePrompt({ cloudTools: [] })).toBe(prompt);
    expect(composeOpenPixoGamePrompt({ cloudTools: [TOOLS[0]!] })).toBe(prompt);
    expect(composeOpenPixoGamePrompt({ cloudTools: TOOLS, streamFormat: 'plain' })).toBe(composeOpenPixoGamePrompt({ streamFormat: 'plain' }));
  });
});
