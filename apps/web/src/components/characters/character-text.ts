import type { CharacterErrorCode, CharacterJob, CharacterJobState, CharacterMotion, CharacterPart, LocalCharacter } from '@openpixo/contracts';
import type { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { characterErrorCode, CharacterRequestError } from '../../providers/characters';

type Translate = ReturnType<typeof useI18n>['t'];

const ERRORS: Partial<Record<CharacterErrorCode, keyof Dict>> = {
  ACCOUNT_SIGNED_OUT: 'characters.error.signedOut', INSUFFICIENT_CREDITS: 'characters.error.credits', CHARACTER_PAUSED: 'characters.paused', CHARACTER_BRIEF_INVALID: 'characters.error.price', CHARACTER_BRIEF_EXPIRED: 'characters.error.price',
  CHARACTER_TEXT_REFUSED: 'characters.error.refused', CHARACTER_NOT_FOUND: 'characters.error.gone', CHARACTER_BUSY: 'characters.error.busy', CHARACTER_FULL: 'characters.error.full', CHARACTER_NOT_FITTED: 'characters.error.notFitted', CHARACTER_FITS: 'characters.error.fits',
  CHARACTER_RATE_LIMITED: 'characters.error.limited', CHARACTER_DRAWING_FAILED: 'characters.error.drawing', CHARACTER_CONTENT_BLOCKED: 'characters.error.blocked', CHARACTER_MOTION_FAILED: 'characters.error.motion', CHARACTER_TIMED_OUT: 'characters.error.timedOut',
  CHARACTER_PACKING_FAILED: 'characters.error.packing', CHARACTER_DOWNLOAD_FAILED: 'characters.error.download', CLOUD_UNAVAILABLE: 'characters.error.cloud', CHARACTER_PLAYER_EDITED: 'characters.playerEdited',
};

/** What went wrong, in the user's language. The daemon's own words say what to do about a game. */
export function errorText(t: Translate, error: unknown): string {
  const code = characterErrorCode(error);
  if (code === 'CHARACTER_INSTALL_FAILED' && error instanceof CharacterRequestError) return error.message;
  return codeText(t, code);
}
export function codeText(t: Translate, code: CharacterErrorCode | null): string {
  const key = code ? ERRORS[code] : undefined;
  return t(key ?? 'characters.error.unknown');
}

export const isOpen = (job: CharacterJob | null): boolean => Boolean(job && job.state !== 'succeeded' && job.state !== 'failed');
export const isWorking = (c: LocalCharacter): boolean => isOpen(c.job);

/** The steps of an order that the user is shown. */
export const STEPS = ['drawing', 'checking', 'fitting', 'packing'] as const;
export function stepOf(state: CharacterJobState): number {
  if (state === 'waiting') return 0;
  if (state === 'posing') return 2;
  const i = (STEPS as readonly string[]).indexOf(state);
  return i < 0 ? STEPS.length : i;
}
const STATES: Record<CharacterJobState, keyof Dict> = {
  waiting: 'characters.state.waiting', drawing: 'characters.state.drawing', checking: 'characters.state.checking', fitting: 'characters.state.fitting', posing: 'characters.state.posing', packing: 'characters.state.packing', succeeded: 'characters.state.done', failed: 'characters.state.failed',
};
export const stateText = (t: Translate, state: CharacterJobState): string => t(STATES[state]);

const PARTS: Record<CharacterPart, keyof Dict> = { hero: 'characters.part.hero', armor: 'characters.part.armor', gear: 'characters.part.gear', motion: 'characters.part.motion', fit: 'characters.part.fit' };
export const partText = (t: Translate, part: CharacterPart): string => t(PARTS[part]);

const MOTIONS: Record<string, keyof Dict> = {
  idle: 'characters.motion.idle', walk: 'characters.motion.walk', run: 'characters.motion.run', jump: 'characters.motion.jump', fall: 'characters.motion.fall', land: 'characters.motion.land',
  attack: 'characters.motion.attack', heavy: 'characters.motion.heavy', hurt: 'characters.motion.hurt', down: 'characters.motion.down', cheer: 'characters.motion.cheer',
};
/** The user's own words for a motion that was written for them; its name is for the game's code. */
export function motionText(t: Translate, m: Pick<CharacterMotion, 'name' | 'builtIn' | 'shown'>): string {
  const key = m.builtIn ? MOTIONS[m.name] : undefined;
  return key ? t(key) : m.shown || m.name;
}

/** Built-in motions in the order they are used, then the bought ones. */
const ORDER = Object.keys(MOTIONS);
export const inOrder = (motions: readonly CharacterMotion[]): CharacterMotion[] => [...motions].sort((a, b) => (a.builtIn ? ORDER.indexOf(a.name) : 99) - (b.builtIn ? ORDER.indexOf(b.name) : 99));
