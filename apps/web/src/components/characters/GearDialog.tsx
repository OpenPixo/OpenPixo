import { useMemo, useState } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, SegmentedTabs, Textarea } from '@openpixo/components';
import { CHARACTER_OWN_WEAPON, type CharacterBriefRequest, type CharacterDesign, type CharacterGear, type CharacterItem, type CharacterService, type LocalCharacter } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { pieceIcon } from '../../providers/characters';
import { Icon } from '../Icon';
import theme from '../generate/studio-theme.module.css';
import styles from './Characters.module.css';

/** What one character may take along, so that its package can always be made. The cloud has the last word. */
const ROOM = { sets: 12, weapons: 24, capes: 12 } as const;

/** Takes along what the account owns, has armour drawn again for this body, or orders new gear. */
export function GearDialog({ character: c, gear, service, busy, asking, onClose, onSave, onAsk }: {
  character: LocalCharacter;
  gear: CharacterGear | null;
  service: CharacterService | null;
  busy: boolean;
  asking: boolean;
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
  onAsk: (request: Omit<CharacterBriefRequest, 'characterId'>) => Promise<void>;
  onGear: (g: CharacterGear) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'own' | 'new'>('own'), [kind, setKind] = useState<'armor' | 'gear'>('gear'), [text, setText] = useState(''), [saving, setSaving] = useState(false);
  const worn = useMemo(() => [...c.items.sets, ...c.items.weapons, ...c.items.capes].map(i => i.id).filter(id => id !== CHARACTER_OWN_WEAPON), [c.items]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(worn));
  const designs = gear?.designs ?? [], count = (prefix: string): number => [...picked].filter(id => id.startsWith(prefix)).length;
  const full = count('set') > ROOM.sets || count('weapon') > ROOM.weapons || count('cape') > ROOM.capes, changed = picked.size !== worn.length || worn.some(id => !picked.has(id));
  const flip = (ids: readonly string[], on: boolean): void => setPicked(before => { const next = new Set(before); for (const id of ids) if (on) next.add(id); else next.delete(id); return next; });
  const price = service?.prices;

  const piece = (i: CharacterItem, usable: boolean) => <button key={i.id} type="button" className={picked.has(i.id) ? styles.cellOn : styles.cell} aria-pressed={picked.has(i.id)} disabled={!usable} aria-label={i.label || i.id} title={i.label || i.id} onClick={() => flip([i.id], !picked.has(i.id))} data-testid={`gear-${i.id}`}>
    <img src={pieceIcon(i.id)} alt="" loading="lazy" draggable={false} /></button>;
  const design = (d: CharacterDesign) => {
    const items = [...d.sets, ...d.weapons, ...d.capes], usable = d.kind === 'gear' || c.fits.includes(d.id), all = items.every(i => picked.has(i.id));
    return <section key={d.id} className={styles.design}>
      <h3>{t(d.kind === 'armor' ? 'characters.part.armor' : 'characters.part.gear')}{d.style !== c.style && <em className={styles.otherStyle}>{t('characters.otherStyle')}</em>}
        {usable ? <Button size="sm" variant="ghost" onClick={() => flip(items.map(i => i.id), !all)}>{t(all ? 'characters.noneOf' : 'characters.allOf')}</Button>
          : <Button size="sm" variant="primary" disabled={busy || asking || !service || service.paused} onClick={() => void onAsk({ kind: 'fit', design: d.id })} data-testid={`fit-${d.id}`}>{price ? t('characters.fitFor', { credits: price.fit }) : t('characters.fit')}</Button>}</h3>
      {!usable && <p className={styles.hint}>{t('characters.fitHint', { name: c.name })}</p>}
      <div className={styles.cells}>{items.map(i => piece(i, usable))}</div>
    </section>;
  };

  return <Dialog className={`${theme.studio} ${styles.dialog}`} data-theme="dark" size="lg" ariaLabel={t('characters.gearOf', { name: c.name })} onClose={onClose}>
    <DialogHeader><DialogTitle>{t('characters.gearOf', { name: c.name })}</DialogTitle></DialogHeader>
    <DialogBody>
      <SegmentedTabs label={t('characters.gear')} value={tab} onValueChange={v => setTab(v as 'own' | 'new')} items={[{ value: 'own', label: t('characters.owned') }, { value: 'new', label: t('characters.newGear') }]} />
      {tab === 'own' ? <>
        <p className={styles.hint}>{t('characters.ownedHint')}</p>
        {designs.length ? designs.map(design) : <p className={styles.none}>{t('characters.noGear')}</p>}
      </> : <div className={styles.newGear}>
        <SegmentedTabs label={t('characters.newGear')} value={kind} onValueChange={v => setKind(v as 'armor' | 'gear')} items={[{ value: 'gear', label: t('characters.part.gear') }, { value: 'armor', label: t('characters.part.armor') }]} />
        <Textarea rows={3} maxLength={600} value={text} disabled={asking} placeholder={t(kind === 'gear' ? 'characters.gearPlaceholder' : 'characters.armourPlaceholder')} aria-label={t('characters.newGear')} onChange={e => setText(e.target.value)} />
        <p className={styles.hint}>{t(kind === 'gear' ? 'characters.gearShared' : 'characters.armourShared', { name: c.name })}</p>
        <Button variant="primary" disabled={busy || asking || text.trim().length < 2 || !service || service.paused} onClick={() => void onAsk({ kind, text: text.trim() })} data-testid="gear-price">{asking ? t('characters.understanding') : price ? t('characters.makeFor', { credits: price[kind] }) : t('characters.make')}</Button>
      </div>}
    </DialogBody>
    <DialogFooter>
      <span className={full ? styles.problem : styles.hint}>{full ? <><Icon name="alert-triangle" size={13} /> {t('characters.tooMuch', { sets: ROOM.sets, weapons: ROOM.weapons, capes: ROOM.capes })}</> : t('characters.taken', { sets: count('set'), weapons: count('weapon'), capes: count('cape') })}</span>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" disabled={!changed || full || saving || busy} onClick={() => { setSaving(true); void onSave([...picked]).finally(() => setSaving(false)); }} data-testid="gear-save">{t(saving ? 'characters.saving' : 'common.save')}</Button>
    </DialogFooter>
  </Dialog>;
}
