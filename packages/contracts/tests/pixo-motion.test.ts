import { describe, expect, it } from 'vitest';
import {
  MOTION_API_ERROR_CODES, MOTION_CHARACTER_STATES, MOTION_ERROR_CODES, MOTION_JOB_STATES, MOTION_LOCAL_ERROR_CODES, MOTION_NAME_MAX, MOTION_PICTURE_MAX_BYTES, MOTION_PICTURE_TYPES,
  MOTION_PORTRAIT_STATES, MOTION_TEXT_MAX,
} from '../src/api/pixo-motion.js';
import { composeOpenPixoGamePrompt, GAME_MOTION_BLOCK_HEADING, renderGameMotionBlock } from '../src/prompts/openpixo-game.js';

/** The app's copy of the cloud's contract says what the cloud says. A change on either side changes this list. */
describe('the Pixo Motion contract', () => {
  it('has the cloud\'s states, limits and codes', () => {
    expect(MOTION_PORTRAIT_STATES).toEqual(['painting', 'ready', 'failed']);
    expect(MOTION_JOB_STATES).toEqual(['waiting', 'painting', 'checking', 'building', 'baking', 'succeeded', 'failed']);
    expect(MOTION_CHARACTER_STATES).toEqual(['making', 'ready', 'failed']);
    expect([MOTION_TEXT_MAX, MOTION_NAME_MAX, MOTION_PICTURE_MAX_BYTES]).toEqual([600, 40, 8 * 1024 * 1024]);
    expect(MOTION_PICTURE_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    expect(MOTION_ERROR_CODES).toEqual([
      'ACCOUNT_SIGNED_OUT', 'CLOUD_UNAVAILABLE', 'INSUFFICIENT_CREDITS', 'MOTION_PAUSED', 'MOTION_REQUEST_INVALID', 'MOTION_REQUEST_CONFLICT',
      'MOTION_PICTURE_INVALID', 'MOTION_NOT_FOUND', 'MOTION_PORTRAIT_LIMIT', 'MOTION_PORTRAIT_NOT_READY', 'MOTION_PORTRAIT_USED', 'MOTION_PORTRAIT_EXPIRED',
      'MOTION_BUSY', 'MOTION_RATE_LIMITED', 'MOTION_CONTENT_BLOCKED', 'MOTION_PAINTING_FAILED', 'MOTION_BUILD_FAILED', 'MOTION_TIMED_OUT',
    ]);
  });

  it('keeps the daemon\'s own codes apart from the cloud\'s', () => {
    expect(MOTION_API_ERROR_CODES).toEqual([...MOTION_ERROR_CODES, ...MOTION_LOCAL_ERROR_CODES]);
    expect(new Set(MOTION_API_ERROR_CODES).size).toBe(MOTION_API_ERROR_CODES.length);
  });
});

describe('moving characters in the game prompt', () => {
  const input = { baseDir: '/games/foxhole', mediaContractBlock: 'MEDIA' };
  it('are named only in a build that has them, and never while planning', () => {
    expect(renderGameMotionBlock(null)).toBe('');
    expect(composeOpenPixoGamePrompt(input)).not.toContain(GAME_MOTION_BLOCK_HEADING);
    expect(composeOpenPixoGamePrompt({ ...input, motion: null })).toBe(composeOpenPixoGamePrompt(input));
    const prompt = composeOpenPixoGamePrompt({ ...input, motion: { installed: [{ slug: 'fox-knight', name: 'Fox Knight', file: 'public/assets/characters/fox-knight.pxmo' }] } });
    expect(prompt).toContain(GAME_MOTION_BLOCK_HEADING);
    expect(prompt).toContain('`fox-knight` (Fox Knight) in `public/assets/characters/fox-knight.pxmo`');
    expect(composeOpenPixoGamePrompt({ ...input, motion: { installed: [] }, gamePlan: { status: 'planning' } })).not.toContain(GAME_MOTION_BLOCK_HEADING);
  });

  it('let the agent list, install and propose, never order', () => {
    const block = renderGameMotionBlock({ installed: [] });
    for (const said of ['Moving character page', 'motion list --json', 'motion install <id> --project', 'motion suggest', 'You cannot make or order one']) expect(block).toContain(said);
    expect(block).not.toContain('In this game');
    expect(block).not.toMatch(/motion (?:order|portrait)/u);
  });
});
