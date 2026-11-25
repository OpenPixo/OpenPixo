import { describe, expect, it } from 'vitest';
import { composeOpenPixoGamePrompt, GAME_CHARACTERS_BLOCK_HEADING, renderGameCharactersBlock } from '../src/prompts/openpixo-game.js';

const input = { baseDir: '/games/frostline', mediaContractBlock: 'MEDIA' };
const characters = { installed: [{ slug: 'mail-carrier', name: 'Mail Carrier', folder: 'public/characters/mail-carrier' }] };

describe('animated characters in the game prompt', () => {
  it('are named only when the user can have them', () => {
    expect(renderGameCharactersBlock(null)).toBe('');
    expect(composeOpenPixoGamePrompt(input)).not.toContain(GAME_CHARACTERS_BLOCK_HEADING);
    expect(composeOpenPixoGamePrompt({ ...input, characters: null })).toBe(composeOpenPixoGamePrompt(input));
    const prompt = composeOpenPixoGamePrompt({ ...input, characters });
    expect(prompt).toContain(GAME_CHARACTERS_BLOCK_HEADING);
    expect(prompt).toContain('`mail-carrier` (Mail Carrier) in `public/characters/mail-carrier`');
  });

  it('tell the agent to propose, not to order, and wait for the plan like recipes do', () => {
    expect(renderGameCharactersBlock({ installed: [] })).toMatch(/You cannot order one[^\n]*`suggest`/u);
    expect(renderGameCharactersBlock({ installed: [] })).not.toContain('In this game');
    expect(composeOpenPixoGamePrompt({ ...input, characters, gamePlan: { status: 'planning' } })).not.toContain(GAME_CHARACTERS_BLOCK_HEADING);
  });
});
