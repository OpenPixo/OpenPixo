import {
  CHARACTER_BODIES, CHARACTER_JOB_STATES, CHARACTER_KINDS, CHARACTER_PARTS, CHARACTER_SLOTS, CHARACTER_STATES, CHARACTER_STYLES, CHARACTER_TUNING,
  type AnimatedCharacter, type CharacterBrief, type CharacterDesign, type CharacterGear, type CharacterItem, type CharacterJob, type CharacterJobKind,
  type CharacterOutfit, type CharacterPart, type CharacterService, type CharacterTuning, type CharacterWear,
} from '@openpixo/contracts';
import { CharacterError, isCharacterCode } from './errors.js';

/** The cloud's answers, field by field. What is not named here goes no further; what is missing means the answer is not understood. */

type Row = Record<string, unknown>;
const bad = (): never => { throw new CharacterError('CLOUD_UNAVAILABLE'); };
const row = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : bad();
const rows = (value: unknown, max = 1000): Row[] => Array.isArray(value) && value.length <= max ? value.map(row) : bad();
const text = (value: unknown, max = 300): string => typeof value === 'string' && value.length <= max ? value : bad();
const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : bad();
const one = <T extends string>(all: readonly T[], value: unknown): T => all.find(x => x === value) ?? bad();
const date = (value: unknown): string => { const result = text(value, 64); return Number.isFinite(Date.parse(result)) ? result : bad(); };

export const CHARACTER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** A piece: set4, weapon12, cape0. */
export const PIECE_ID = /^(?:set|weapon|cape)\d{1,5}$/u;
export const DESIGN_ID = /^(?:armor|gear)\d{1,4}$/u;
export const MOTION_NAME = /^[a-z][a-z0-9_]{0,31}$/u;
/** Names of package files. None is a path, a dot file or anything that runs. */
export const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,72}\.(?:png|json|bin)$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

const match = (form: RegExp, value: unknown): string => typeof value === 'string' && form.test(value) ? value : bad();

export function tuning(value: unknown): CharacterTuning {
  const given = value !== null && typeof value === 'object' ? value as Row : {};
  return Object.fromEntries(Object.entries(CHARACTER_TUNING).flatMap(([name, [from, to]]) => {
    const n = given[name];
    return typeof n === 'number' && Number.isFinite(n) ? [[name, Math.min(to, Math.max(from, n))]] : [];
  }));
}

export function wear(value: unknown): CharacterWear {
  const given = value !== null && typeof value === 'object' ? value as Row : {};
  return Object.fromEntries(CHARACTER_SLOTS.flatMap(slot => typeof given[slot] === 'string' && PIECE_ID.test(given[slot]) ? [[slot, given[slot]]] : []));
}

/** Also what a client may save. */
export function outfits(value: unknown): CharacterOutfit[] {
  if (!Array.isArray(value) || value.length > 24) throw new CharacterError('CHARACTER_REQUEST_INVALID');
  let started = false;
  return value.map(entry => {
    const o = entry !== null && typeof entry === 'object' ? entry as Row : {}, name = typeof o.name === 'string' ? o.name.replace(/\p{C}+/gu, ' ').trim() : '';
    if (!name || [...name].length > 40) throw new CharacterError('CHARACTER_REQUEST_INVALID', 'Every outfit needs a name of at most 40 characters.');
    const start = o.start === true && !started;
    started ||= start;
    return { name, wear: wear(o.wear), ...(start ? { start: true as const } : {}) };
  });
}

export function job(value: unknown): CharacterJob {
  const j = row(value);
  return {
    id: match(CHARACTER_ID, j.id), characterId: match(CHARACTER_ID, j.characterId), kind: one<CharacterJobKind>([...CHARACTER_KINDS, 'pack'], j.kind),
    state: one(CHARACTER_JOB_STATES, j.state), creditsReserved: count(j.creditsReserved), creditsCharged: j.creditsCharged == null ? null : count(j.creditsCharged),
    delivered: j.delivered == null ? null : Array.isArray(j.delivered) ? j.delivered.map(p => one(CHARACTER_PARTS, p)) : bad(),
    errorCode: j.errorCode == null ? null : isCharacterCode(j.errorCode) ? j.errorCode : 'CHARACTER_PACKING_FAILED', createdAt: date(j.createdAt), updatedAt: date(j.updatedAt),
  };
}

const items = (value: unknown): CharacterItem[] => rows(value).map(i => ({ id: match(PIECE_ID, i.id), label: text(i.label, 120) }));

export function character(value: unknown): AnimatedCharacter {
  const c = row(value), worn = row(c.items);
  return {
    id: match(CHARACTER_ID, c.id), name: text(c.name), body: one(CHARACTER_BODIES, c.body), style: one(CHARACTER_STYLES, c.style), state: one(CHARACTER_STATES, c.state), revision: count(c.revision),
    items: { sets: items(worn.sets), weapons: items(worn.weapons), capes: items(worn.capes) },
    fits: Array.isArray(c.fits) ? c.fits.map(d => match(DESIGN_ID, d)) : bad(), outfits: outfits(c.outfits),
    motions: rows(c.motions).map(m => ({ name: match(MOTION_NAME, m.name), builtIn: m.builtIn === true, shown: text(m.shown, 400), tuning: tuning(m.tuning) })),
    changed: c.changed === true, job: c.job == null ? null : job(c.job), createdAt: date(c.createdAt), updatedAt: date(c.updatedAt),
  };
}

export const characters = (value: unknown): AnimatedCharacter[] => rows(row(value).characters).map(character);

export function brief(value: unknown): CharacterBrief {
  const b = row(value), s = row(b.shown);
  return {
    briefId: match(CHARACTER_ID, b.briefId), kind: one(CHARACTER_KINDS, b.kind), characterId: b.characterId == null ? null : match(CHARACTER_ID, b.characterId), name: b.name == null ? null : text(b.name),
    body: b.body == null ? null : one(CHARACTER_BODIES, b.body), style: b.style == null ? null : one(CHARACTER_STYLES, b.style),
    shown: { look: text(s.look, 600), clothes: text(s.clothes, 600), colours: text(s.colours, 600), gear: text(s.gear, 600), note: text(s.note, 600) },
    parts: rows(b.parts).map(p => ({ part: one(CHARACTER_PARTS, p.part), credits: count(p.credits) })),
    credits: count(b.credits), available: typeof b.available === 'number' && Number.isSafeInteger(b.available) ? b.available : bad(), expiresAt: date(b.expiresAt),
  };
}

export function service(value: unknown): CharacterService {
  const s = row(value), prices = row(s.prices);
  return { paused: s.paused === true, priceVersion: count(s.priceVersion), prices: Object.fromEntries(CHARACTER_PARTS.map(part => [part, count(prices[part])])) as Record<CharacterPart, number> };
}

export function gear(value: unknown): CharacterGear {
  const g = row(value);
  const design = (d: Row): CharacterDesign => ({
    id: match(DESIGN_ID, d.id), kind: one(['armor', 'gear'] as const, d.kind), style: one(CHARACTER_STYLES, d.style), madeFor: typeof d.madeFor === 'string' && CHARACTER_ID.test(d.madeFor) ? d.madeFor : '',
    sets: items(d.sets), weapons: items(d.weapons), capes: items(d.capes), fits: Array.isArray(d.fits) ? d.fits.map(id => match(CHARACTER_ID, id)) : bad(), createdAt: date(d.createdAt),
  });
  return {
    designs: rows(g.designs).map(design),
    motions: rows(g.motions).map(m => ({ name: match(MOTION_NAME, m.name), shown: text(m.shown, 400), characters: Array.isArray(m.characters) ? m.characters.map(id => match(CHARACTER_ID, id)) : bad() })),
  };
}

export interface RemoteFile { name: string; bytes: number; sha256: string }
export interface RemoteFiles { baseUrl: string; token: string; files: RemoteFile[] }

/** The biggest character the cloud packs has 45 MB of positions (docs/character-service.md there). */
const MAX_FILE = 64 * 1024 * 1024, MAX_ALL = 200 * 1024 * 1024;

/** What can be downloaded. The token goes to `origin` alone. */
export function remoteFiles(value: unknown, origin: string): RemoteFiles {
  const d = row(value), baseUrl = text(d.baseUrl, 2048), seen = new Set<string>();
  let url: URL;
  try { url = new URL(baseUrl); } catch { return bad(); }
  if (url.origin !== origin || url.search || url.hash) bad();
  const files = rows(d.files, 2000).map(f => {
    const name = match(FILE_NAME, f.name), bytes = count(f.bytes);
    if (bytes > MAX_FILE || seen.has(name.toLowerCase())) bad();
    seen.add(name.toLowerCase());
    return { name, bytes, sha256: match(SHA256, f.sha256) };
  });
  if (files.reduce((n, f) => n + f.bytes, 0) > MAX_ALL) bad();
  return { baseUrl: baseUrl.replace(/\/+$/u, ''), token: text(d.token, 4096), files };
}

export function packageFiles(value: unknown, origin: string): RemoteFiles & { revision: number } {
  const revision = count(row(value).revision);
  return { revision: revision || bad(), ...remoteFiles(value, origin) };
}
