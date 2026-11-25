import { describe, expect, it } from 'vitest';
import { composeOpenPixoGamePrompt, GAME_CHARACTERS_BLOCK_HEADING, renderGameCharactersBlock } from '../src/prompts/openpixo-game.js';

const input = { baseDir: '/games/frostline', mediaContractBlock: 'MEDIA' };
const characters = { account: true, installed: [{ slug: 'mail-carrier', name: 'Mail Carrier', folder: 'public/characters/mail-carrier' }] };

describe('animated characters in the game prompt', () => {
  it('are named only when the user can have them', () => {
    expect(renderGameCharactersBlock(null)).toBe('');
    expect(composeOpenPixoGamePrompt(input)).not.toContain(GAME_CHARACTERS_BLOCK_HEADING);
    expect(composeOpenPixoGamePrompt({ ...input, characters: null })).toBe(composeOpenPixoGamePrompt(input));
    const prompt = composeOpenPixoGamePrompt({ ...input, characters });
    expect(prompt).toContain(GAME_CHARACTERS_BLOCK_HEADING);
    expect(prompt).toContain('`mail-carrier` (Mail Carrier) in `public/characters/mail-carrier`');
  });

  it('are explained to someone who is signed out and has the free sample in the game, without commands that need an account', () => {
    const block = renderGameCharactersBlock({ account: false, installed: [{ slug: 'marsh', name: 'Marsh Scavenger', folder: 'characters/marsh', sample: true }] });
    for (const said of ['`marsh` (Marsh Scavenger, the free sample', 'read its `README.md`', 'not yours to edit', 'sign in']) expect(block).toContain(said);
    for (const word of ['suggest', 'tune', 'mine --json', 'You cannot order']) expect(block).not.toContain(word);
    expect(renderGameCharactersBlock({ ...characters, installed: [{ slug: 'marsh', name: 'Marsh Scavenger', folder: 'characters/marsh', sample: true }] })).toContain('for their own characters');
  });

  it('tell the agent to propose, not to order, and wait for the plan like recipes do', () => {
    expect(renderGameCharactersBlock({ installed: [], account: true })).toMatch(/You cannot order one[^\n]*`suggest`/u);
    expect(renderGameCharactersBlock({ installed: [], account: true })).not.toContain('In this game');
    expect(composeOpenPixoGamePrompt({ ...input, characters, gamePlan: { status: 'planning' } })).not.toContain(GAME_CHARACTERS_BLOCK_HEADING);
  });
});
