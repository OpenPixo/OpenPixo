import source from './tuning.json?raw';

/** OpenPixo's Tune tab edits value tokens in this JSON; a page reload applies them. */
export interface TuningEntry<T extends number | boolean | string> {
  value: T;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  group?: string;
}
const entries = JSON.parse(source) as Record<string, TuningEntry<number | boolean | string>>;

export function tuningNumber(key: string): number {
  const value = entries[key]?.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid numeric tuning value: ${key}`);
  return value;
}

export const tuning = {
  playerSpeed: tuningNumber('playerSpeed'),
  jumpVelocity: tuningNumber('jumpVelocity'),
  gravity: tuningNumber('gravity'),
  coinCount: tuningNumber('coinCount'),
  soundVolume: tuningNumber('soundVolume'),
};
