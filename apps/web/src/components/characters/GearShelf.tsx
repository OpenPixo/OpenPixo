import { useState } from 'react';
import { Button, ConfirmDialog, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle, Input, SegmentedTabs } from '@openpixo/components';
import type { CharacterDesign, CharacterGear, CharacterItem, LocalCharacter } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { pieceIcon, removeGearMotion, removePiece, renamePiece } from '../../providers/characters';
import { Icon } from '../Icon';
import theme from '../generate/studio-theme.module.css';
import { errorText, GEAR_TYPES } from './character-text';
import styles from './Characters.module.css';

type Kind = 'sets' | 'weapons' | 'capes' | 'shields' | 'motions';

/** 装备: everything the account owns, whichever character it was made for. */
export function GearShelf({ gear, characters, onGear }: { gear: CharacterGear | null; characters: readonly LocalCharacter[]; onGear: (g: CharacterGear) => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>('weapons'), [edited, setEdited] = useState<CharacterItem | null>(null), [label, setLabel] = useState(''), [gone, setGone] = useState<{ id: string; name: string; motion: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const act = async (work: () => Promise<CharacterGear>): Promise<void> => { setProblem(null); try { onGear(await work()); } catch (e) { setProblem(errorText(t, e)); } };
  const usedBy = (id: string): LocalCharacter[] => characters.filter(c => [...c.items.sets, ...c.items.weapons, ...c.items.capes, ...c.items.shields].some(i => i.id === id));
  const names = (list: readonly LocalCharacter[]): string => list.map(c => c.name).join(', ');
  const designs = gear?.designs ?? [], total = { sets: designs.reduce((n, d) => n + d.sets.length, 0), weapons: designs.reduce((n, d) => n + d.weapons.length, 0), capes: designs.reduce((n, d) => n + d.capes.length, 0), shields: designs.reduce((n, d) => n + d.shields.length, 0), motions: gear?.motions.length ?? 0 };
  const edit = (i: CharacterItem): void => { setEdited(i); setLabel(i.label); };
  const tile = (i: CharacterItem, d: CharacterDesign) => <button key={i.id} type="button" className={styles.tile} onClick={() => edit(i)} data-testid={`shelf-${i.id}`}>
    <img src={pieceIcon(i.id)} alt="" loading="lazy" draggable={false} /><strong>{i.label || i.id}</strong>
    {i.type && <span>{t(GEAR_TYPES[i.type])}</span>}
    <span>{usedBy(i.id).length ? t('characters.usedBy', { names: names(usedBy(i.id)) }) : t('characters.usedByNone')}</span>
    <span className={styles.otherStyle}>{t(d.style === 'ink' ? 'characters.style.ink' : 'characters.style.cute')}</span></button>;

  return <>
    <p className={styles.hint}>{t('characters.gearIntro')}</p>
    {problem && <p className={styles.problem} role="alert">{problem}</p>}
    <SegmentedTabs className={styles.kinds} label={t('characters.gear')} value={kind} onValueChange={v => setKind(v as Kind)} items={([['weapons', 'characters.weapons'], ['shields', 'characters.shields'], ['capes', 'characters.capes'], ['sets', 'characters.armour'], ['motions', 'characters.motions']] as const).map(([value, text]) => ({ value, label: t(text), count: total[value] }))} />
    {kind === 'motions' ? <div className={styles.shelfList}>{(gear?.motions ?? []).map(m => <div key={m.name} className={styles.row}><span><strong>{m.shown || m.name}</strong> <code>{m.name}</code> {m.characters.length ? t('characters.usedBy', { names: names(characters.filter(c => m.characters.includes(c.id))) }) : t('characters.usedByNone')}</span>
      <Button size="icon" variant="ghost" aria-label={t('characters.throwAway', { name: m.shown || m.name })} onClick={() => setGone({ id: m.name, name: m.shown || m.name, motion: true })}><Icon name="trash" size={14} /></Button></div>)}</div>
      : <div className={styles.tiles}>{designs.flatMap(d => d[kind].map(i => tile(i, d)))}</div>}
    {total[kind] === 0 && <p className={styles.none}>{t('characters.noGear')}</p>}
    {edited && <Dialog className={`${theme.studio} ${styles.dialog}`} data-theme="dark" size="sm" ariaLabel={edited.label || edited.id} onClose={() => setEdited(null)} as="form" onSubmit={e => { e.preventDefault(); const name = label.trim(); if (name) void act(() => renamePiece(edited.id, name)); setEdited(null); }}>
      <DialogHeader><DialogTitle>{edited.label || edited.id}</DialogTitle></DialogHeader>
      <DialogBody><img className={styles.bigIcon} src={pieceIcon(edited.id)} alt="" /><Input value={label} maxLength={40} aria-label={t('characters.name')} onChange={e => setLabel(e.target.value)} /><p className={styles.hint}>{t('characters.pieceId', { id: edited.id })}</p></DialogBody>
      <DialogFooter><Button variant="danger" onClick={() => { setGone({ id: edited.id, name: edited.label || edited.id, motion: false }); setEdited(null); }}>{t('characters.throwAwayShort')}</Button><Button variant="ghost" onClick={() => setEdited(null)}>{t('common.cancel')}</Button><Button variant="primary" type="submit" disabled={!label.trim()}>{t('common.save')}</Button></DialogFooter>
    </Dialog>}
    <ConfirmDialog open={gone !== null} title={t('characters.throwAway', { name: gone?.name ?? '' })} confirmLabel={t('characters.throwAwayShort')} cancelLabel={t('common.cancel')} destructive onCancel={() => setGone(null)}
      onConfirm={() => { if (!gone) return; const { id, motion } = gone; setGone(null); void act(() => motion ? removeGearMotion(id) : removePiece(id)); }}>{t('characters.throwAwayBody')}</ConfirmDialog>
  </>;
}
