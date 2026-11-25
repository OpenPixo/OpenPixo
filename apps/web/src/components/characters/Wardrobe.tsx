import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@openpixo/components';
import type { CharacterItem, CharacterOutfit, LocalCharacter } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { characterFile } from '../../providers/characters';
import { Icon } from '../Icon';
import type { PixoCharacterPack, PixoSlot, PixoWear } from '../../lib/characters/pixo-character';
import { FRAMES, paint } from './stage';
import styles from './Characters.module.css';

const ARMOUR: readonly { slot: 'head' | 'body' | 'arm' | 'leg'; label: keyof Dict; picture: string }[] = [
  { slot: 'head', label: 'characters.slot.head', picture: 'head' }, { slot: 'body', label: 'characters.slot.body', picture: 'torso' }, { slot: 'arm', label: 'characters.slot.arm', picture: 'armN' }, { slot: 'leg', label: 'characters.slot.leg', picture: 'legN' },
];
export const same = (a: PixoWear, b: PixoWear): boolean => { const keys = (w: PixoWear): string => JSON.stringify(Object.entries(w).filter(([, v]) => v).sort()); return keys(a) === keys(b); };

/** The same saved outfit, in whatever answer it came. */
const is = (a: CharacterOutfit, b: CharacterOutfit): boolean => a.name === b.name && same(a.wear, b.wear);

/** One outfit as it looks on the character. */
function Outfit({ pack, wear }: { pack: PixoCharacterPack; wear: PixoWear }) {
  const canvas = useRef<HTMLCanvasElement>(null), key = JSON.stringify(wear);
  useEffect(() => {
    if (!canvas.current) return;
    const actor = pack.create();
    actor.wear = JSON.parse(key) as PixoWear;
    paint(canvas.current, actor, FRAMES.card);
  }, [pack, key]);
  return <canvas ref={canvas} className={styles.outfitCanvas} aria-hidden="true" />;
}

export function Wardrobe({ character: c, pack, wear, onWear, onOutfits, onGear, busy }: { character: LocalCharacter; pack: PixoCharacterPack; wear: PixoWear; onWear: (w: PixoWear) => void; onOutfits: (edit: (now: readonly CharacterOutfit[]) => CharacterOutfit[]) => void; onGear: () => void; busy: boolean }) {
  const { t } = useI18n();
  const [naming, setNaming] = useState<string | null>(null);
  const has = (slot: PixoSlot, id: string): boolean => pack.data.items[slot].includes(id), put = (slot: PixoSlot, id: string | null): void => { const { [slot]: _, ...rest } = wear; onWear(id ? { ...rest, [slot]: id } : rest); };
  // what was taken along but is not in the package yet cannot be shown
  const sets = c.items.sets.filter(s => has('head', s.id)), weapons = c.items.weapons.filter(w => has('weapon', w.id)), capes = c.items.capes.filter(x => has('cape', x.id));
  const pick = <T,>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)];
  const random = (): void => onWear(Object.fromEntries([...ARMOUR.map(a => [a.slot, pick(sets)?.id]), ['weapon', pick(weapons)?.id], ['cape', Math.random() < 0.7 ? pick(capes)?.id : undefined]].filter(([, id]) => id)) as PixoWear);
  const cell = (slot: PixoSlot, item: CharacterItem | null, picture: string | null, key: string) => {
    const on = (wear[slot] ?? null) === (item?.id ?? null), label = item ? item.label || item.id : t('characters.nothing');
    return <button key={key} type="button" className={on ? styles.cellOn : styles.cell} aria-pressed={on} aria-label={label} title={label} onClick={() => put(slot, item?.id ?? null)} data-testid={`wear-${slot}-${item?.id ?? 'none'}`}>
      {picture ? <img src={characterFile(c.id, c.revision, picture)} alt="" loading="lazy" draggable={false} /> : <Icon name="minus" size={14} />}</button>;
  };
  const shelf = (slot: 'weapon' | 'cape', title: string, list: readonly CharacterItem[]) => <section><h3>{title}</h3><div className={styles.cells}>{cell(slot, null, null, 'none')}{list.map(i => cell(slot, i, `icon-${i.id}.png`, i.id))}</div></section>;

  return <div className={styles.panelBody}>
    <section>
      <h3>{t('characters.outfits')}<span><Button size="sm" variant="ghost" onClick={random}>{t('characters.random')}</Button><Button size="sm" variant="ghost" onClick={() => onWear({})}>{t('characters.bare')}</Button></span></h3>
      <div className={styles.outfits}>
        {c.outfits.map((o, i) => <div key={`${o.name}${i}`} className={same(o.wear, wear) ? styles.outfitOn : styles.outfit}>
          <button type="button" aria-pressed={same(o.wear, wear)} onClick={() => onWear({ ...o.wear })}><Outfit pack={pack} wear={o.wear} /><span>{o.name}</span></button>
          <div className={styles.outfitTools}>
            <button type="button" aria-label={t('characters.startWith', { name: o.name })} title={t('characters.startWith', { name: o.name })} aria-pressed={o.start === true} className={o.start ? styles.startOn : ''} onClick={() => onOutfits(now => now.map(x => { const { start: _, ...rest } = x; return is(x, o) && !o.start ? { ...rest, start: true as const } : rest; }))}><Icon name="star" size={12} /></button>
            <button type="button" aria-label={t('characters.removeOutfit', { name: o.name })} title={t('characters.removeOutfit', { name: o.name })} onClick={() => onOutfits(now => now.filter(x => !is(x, o)))}><Icon name="close" size={12} /></button>
          </div>
        </div>)}
        {c.outfits.length < 24 && !c.outfits.some(o => same(o.wear, wear)) && naming === null && <button type="button" className={styles.outfitNew} onClick={() => setNaming('')} data-testid="outfit-save"><Icon name="plus" size={16} /><span>{t('characters.saveOutfit')}</span></button>}
      </div>
      {naming !== null && <form className={styles.rename} onSubmit={e => { e.preventDefault(); const name = naming.trim(); if (!name) return; onOutfits(now => [...now, { name, wear: { ...wear }, ...(now.length ? {} : { start: true as const }) }]); setNaming(null); }}>
        <Input autoFocus value={naming} maxLength={40} placeholder={t('characters.outfitName')} aria-label={t('characters.outfitName')} onChange={e => setNaming(e.target.value)} /><Button size="sm" variant="primary" type="submit" disabled={!naming.trim()}>{t('common.save')}</Button><Button size="sm" variant="ghost" onClick={() => setNaming(null)}>{t('common.cancel')}</Button>
      </form>}
      <p className={styles.hint}>{t('characters.outfitsHint')}</p>
    </section>
    {sets.length > 0 && <section>
      <h3>{t('characters.armour')}</h3>
      <div className={styles.armour}>
        <div className={styles.armourRow}><span /><button type="button" className={styles.setName} onClick={() => onWear(Object.fromEntries(Object.entries(wear).filter(([s]) => !ARMOUR.some(a => a.slot === s))))}>{t('characters.nothing')}</button>
          {sets.map(s => <button key={s.id} type="button" className={styles.setName} title={t('characters.wholeSet')} onClick={() => onWear({ ...wear, head: s.id, body: s.id, arm: s.id, leg: s.id })} data-testid={`wear-whole-${s.id}`}>{s.label || s.id}</button>)}</div>
        {ARMOUR.map(a => <div key={a.slot} className={styles.armourRow}><span>{t(a.label)}</span>{cell(a.slot, null, null, 'none')}{sets.map(s => cell(a.slot, s, `${s.id}-${a.picture}.png`, s.id))}</div>)}
      </div>
    </section>}
    {shelf('weapon', t('characters.weapons'), weapons)}
    {capes.length > 0 && shelf('cape', t('characters.capes'), capes)}
    <Button className={styles.addGear} disabled={busy} onClick={onGear} data-testid="character-gear"><Icon name="plus" size={14} /> {t('characters.addGear')}</Button>
  </div>;
}
