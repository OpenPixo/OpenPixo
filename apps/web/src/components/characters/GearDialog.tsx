import { useMemo, useState } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, SegmentedTabs, Textarea } from '@openpixo/components';
import { CHARACTER_OWN_WEAPON, type CharacterBriefRequest, type CharacterDesign, type CharacterGear, type CharacterGearType, type CharacterItem, type CharacterService, type LocalCharacter } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { pieceIcon } from '../../providers/characters';
import { Icon } from '../Icon';
import { GearTypes } from './GearTypes';
import { itemText } from './character-text';
import theme from '../generate/studio-theme.module.css';
import styles from './Characters.module.css';

/** What one character may take along, so that its package can always be made. Capes and shields share their room. The cloud has the last word. */
const ROOM = { sets: 12, weapons: 24, backs: 12, groups: 6 } as const;
const itemsOf = (d: CharacterDesign): CharacterItem[] => [...d.sets, ...d.weapons, ...d.shields, ...d.capes];
/** How many of the groups below the pieces come from. */
const groups = (designs: readonly CharacterDesign[], kind: CharacterDesign['kind'], picked: ReadonlySet<string>): number => designs.filter(d => d.kind === kind && itemsOf(d).some(i => picked.has(i.id))).length;

/** Takes along what the account owns, or orders new gear. */
export function GearDialog({ character: c, gear, service, busy, asking, problem, onClose, onSave, onAsk }: {
  character: LocalCharacter;
  gear: CharacterGear | null;
  service: CharacterService | null;
  busy: boolean;
  asking: boolean;
  /** Why the last try did not work. The page's own line is behind this dialog. */
  problem: string | null;
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
  onAsk: (request: Omit<CharacterBriefRequest, 'characterId'>) => Promise<void>;
  onGear: (g: CharacterGear) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'own' | 'new'>('own'), [kind, setKind] = useState<'armor' | 'gear'>('gear'), [text, setText] = useState(''), [types, setTypes] = useState<CharacterGearType[]>([]), [saving, setSaving] = useState(false);
  const worn = useMemo(() => [...c.items.sets, ...c.items.weapons, ...c.items.capes, ...c.items.shields].map(i => i.id).filter(id => id !== CHARACTER_OWN_WEAPON), [c.items]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(worn));
  const designs = gear?.designs ?? [], count = (prefix: string): number => [...picked].filter(id => id.startsWith(prefix)).length;
  const scattered = groups(designs, 'armor', picked) > ROOM.groups || groups(designs, 'gear', picked) > ROOM.groups, full = count('set') > ROOM.sets || count('weapon') > ROOM.weapons || count('cape') + count('shield') > ROOM.backs, changed = picked.size !== worn.length || worn.some(id => !picked.has(id));
  const flip = (ids: readonly string[], on: boolean): void => setPicked(before => { const next = new Set(before); for (const id of ids) if (on) next.add(id); else next.delete(id); return next; });
  const price = service?.prices;

  const piece = (i: CharacterItem) => <button key={i.id} type="button" className={picked.has(i.id) ? styles.cellOn : styles.cell} aria-pressed={picked.has(i.id)} aria-label={itemText(t, i)} title={itemText(t, i)} onClick={() => flip([i.id], !picked.has(i.id))} data-testid={`gear-${i.id}`}>
    <img src={pieceIcon(i.id)} alt="" loading="lazy" draggable={false} /></button>;
  const design = (d: CharacterDesign) => {
    const items = itemsOf(d), all = items.every(i => picked.has(i.id));
    return <section key={d.id} className={styles.design}>
      <h3>{t(d.kind === 'armor' ? 'characters.part.armor' : 'characters.part.gear')}{d.style !== c.style && <em className={styles.otherStyle}>{t('characters.otherStyle')}</em>}
        <Button size="sm" variant="ghost" onClick={() => flip(items.map(i => i.id), !all)}>{t(all ? 'characters.noneOf' : 'characters.allOf')}</Button></h3>
      <div className={styles.cells}>{items.map(piece)}</div>
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
        {kind === 'gear' && <GearTypes value={types} disabled={asking} onChange={setTypes} />}
        <p className={styles.hint}>{t(kind === 'gear' ? 'characters.gearShared' : 'characters.armourShared', { name: c.name })}</p>
        <Button variant="primary" disabled={busy || asking || text.trim().length < 2 || !service || service.paused} onClick={() => void onAsk({ kind, text: text.trim(), ...(kind === 'gear' && types.length ? { types } : {}) })} data-testid="gear-price">{asking ? t('characters.understanding') : price ? t('characters.makeFor', { credits: price[kind] }) : t('characters.make')}</Button>
      </div>}
    </DialogBody>
    <DialogFooter>
      <span className={full || scattered || problem ? styles.problem : styles.hint} {...(problem ? { role: 'alert' } : {})}>{full || scattered ? <><Icon name="alert-triangle" size={13} /> {full ? t('characters.tooMuch', { sets: ROOM.sets, weapons: ROOM.weapons, backs: ROOM.backs }) : t('characters.tooScattered', { count: ROOM.groups })}</> : problem ?? t('characters.taken', { sets: count('set'), weapons: count('weapon'), backs: count('cape') + count('shield') })}</span>
      <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant="primary" disabled={!changed || full || scattered || saving || busy} onClick={() => { setSaving(true); void onSave([...picked]).finally(() => setSaving(false)); }} data-testid="gear-save">{t(saving ? 'characters.saving' : 'common.save')}</Button>
    </DialogFooter>
  </Dialog>;
}
