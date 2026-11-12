import source from './tuning.json?raw';

/** Keep game settings in tuning.json so OpenPixo's Tune tab can edit them. */
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

export const tuning = { playerSpeed: tuningNumber('playerSpeed') };
