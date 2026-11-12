import { resolveLocalizedText, type StoreCatalogItem } from '@openpixo/contracts';
import type { WorkshopKind } from '../../state/store';

/** Order the Workshop presents its categories in: paid content first, connections last. */
export const WORKSHOP_TAB_ORDER: readonly WorkshopKind[] = ['asset-pack', 'skill', 'project-template', 'mcp'];

export type WorkshopItem = StoreCatalogItem & { kind: WorkshopKind };

export function itemTitle(item: Pick<StoreCatalogItem, 'name' | 'title' | 'title_i18n'>, locale: string): string {
  return resolveLocalizedText({ en: item.title ?? item.name, ...item.title_i18n }, locale) || item.name;
}

export function itemDescription(item: Pick<StoreCatalogItem, 'description' | 'description_i18n'>, locale: string): string {
  return resolveLocalizedText({ en: item.description ?? '', ...item.description_i18n }, locale);
}

/** Paid items stay buyable until the account owns them; free items never need a purchase. */
export function needsPurchase(item: Pick<StoreCatalogItem, 'pricing' | 'owned'>): boolean {
  return item.pricing.type === 'paid' && !item.owned;
}

/** Everything a search box query may match, folded for a case-insensitive contains test. */
export function searchText(item: StoreCatalogItem, kindLabel: string, locale: string): string {
  return [item.name, item.title, item.description, item.kind, kindLabel,
    ...Object.values(item.title_i18n ?? {}), ...Object.values(item.description_i18n ?? {}),
    ...item.engines, ...(item.tags ?? []), ...(item.tags ?? []).map(humanizeTag)].join(' ').toLocaleLowerCase(locale);
}

/** Tags that describe the catalogue itself rather than what an item is about. */
const NOISE_TAGS = new Set(['first-party', 'openpixo', 'game-development', 'skill', 'mcp', 'asset-pack', 'project-template',
  'template', 'godot', 'phaser', 'unity', 'threejs', 'blender', 'any', 'paid', 'free']);

/** The most common descriptive tags, for one-tap filter chips. Ties keep catalogue order. */
export function quickTags(items: readonly StoreCatalogItem[], limit = 10): string[] {
  const counts = new Map<string, number>();
  for (const item of items) for (const tag of new Set(item.tags ?? [])) {
    const key = tag.toLowerCase();
    if (!NOISE_TAGS.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag]) => tag);
}

export function hasTag(item: StoreCatalogItem, tag: string): boolean {
  return (item.tags ?? []).some(entry => entry.toLowerCase() === tag);
}

export function humanizeTag(tag: string): string {
  return tag.replace(/[-_]+/g, ' ');
}

/** Packs the spotlight leads with when present; anything else paid follows in catalogue order. */
const FLAGSHIP_PACKS = ['openpixo/pixel-dungeon-kit', 'openpixo/topdown-hero-creator', 'openpixo/forest-platformer-kit'];

export type HeroSlide =
  | { kind: 'pack'; item: WorkshopItem }
  | { kind: 'toolkit'; skills: WorkshopItem[] }
  | { kind: 'template'; item: WorkshopItem };

/** Two to four spotlight slides: a flagship pack, the free toolkit, a template, then a second pack. */
export function heroSlides(items: readonly WorkshopItem[]): HeroSlide[] {
  const packs = items.filter(item => item.kind === 'asset-pack');
  const ranked = [
    ...FLAGSHIP_PACKS.flatMap(name => packs.filter(item => item.name === name)),
    ...packs.filter(item => !FLAGSHIP_PACKS.includes(item.name) && item.pricing.type === 'paid'),
    ...packs.filter(item => !FLAGSHIP_PACKS.includes(item.name) && item.pricing.type !== 'paid'),
  ];
  const skills = items.filter(item => item.kind === 'skill');
  const template = items.find(item => item.kind === 'project-template');
  const slides: HeroSlide[] = [];
  if (ranked[0]) slides.push({ kind: 'pack', item: ranked[0] });
  if (skills.length) slides.push({ kind: 'toolkit', skills });
  if (template) slides.push({ kind: 'template', item: template });
  if (ranked[1]) slides.push({ kind: 'pack', item: ranked[1] });
  return slides;
}

/** A small stable hash so fallback artwork differs per item but never between renders. */
export function nameSeed(name: string): number {
  let hash = 2166136261;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
