import { describe, expect, it } from 'vitest';
import {
  composeOpenPixoGamePrompt,
  GAME_IMAGE_LOOK_BLOCK_HEADING,
  GAME_MEDIA_CONTRACT_HEADING,
  GAME_SHAPE_BLOCK_HEADING,
  GAME_VERIFICATION_BLOCK_HEADING,
} from '../src/prompts/openpixo-game.js';

const LOOK_COMMAND = '"$PIXO_NODE_BIN" "$PIXO_BIN" look <path> --question "<specific question>"';

describe('pixo look in the game prompt', () => {
  it('teaches looking at images only to a run that sees them through pixo look', () => {
    const prompt = composeOpenPixoGamePrompt({ imageLook: true });
    expect(prompt).toContain(GAME_IMAGE_LOOK_BLOCK_HEADING);
    expect(prompt).toContain(LOOK_COMMAND);
    expect(prompt).toContain('You cannot open images directly in this run');
    expect(prompt).toContain('Ask one specific question per look');
    expect(prompt).toContain('A look costs a fraction of a credit');
    // A cheap look is still a step: a Flash run spent 18 looks hunting for polish (2026-11-15).
    expect(prompt).toContain('Do not look again to find more things to improve.');
    // The other blocks keep their wording; this block says how this run satisfies it.
    expect(prompt).toContain('If you can view images, open every `screenshots[].path`');
    expect(prompt).toContain('Wherever these instructions say "if you can view images"');
    // Stable text, after the game shape and before the media contract.
    const at = prompt.indexOf(GAME_IMAGE_LOOK_BLOCK_HEADING);
    expect(prompt.indexOf(GAME_SHAPE_BLOCK_HEADING)).toBeLessThan(at);
    expect(at).toBeLessThan(prompt.indexOf(GAME_MEDIA_CONTRACT_HEADING));
    expect(at).toBeLessThan(prompt.indexOf(GAME_VERIFICATION_BLOCK_HEADING));
  });

  it('leaves the prompt byte for byte unchanged without the input, and says nothing to a text-only provider', () => {
    const prompt = composeOpenPixoGamePrompt({});
    expect(prompt).not.toContain(GAME_IMAGE_LOOK_BLOCK_HEADING);
    expect(prompt).not.toContain('"$PIXO_BIN" look');
    expect(composeOpenPixoGamePrompt({ imageLook: false })).toBe(prompt);
    expect(composeOpenPixoGamePrompt({ imageLook: true, streamFormat: 'plain' })).toBe(composeOpenPixoGamePrompt({ streamFormat: 'plain' }));
  });
});
