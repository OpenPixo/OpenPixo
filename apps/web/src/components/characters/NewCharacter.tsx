import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Select, Textarea } from '@openpixo/components';
import { CHARACTER_STYLES, type CharacterBrief, type CharacterGearType, type CharacterService, type CharacterStyle } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { characterErrorCode, priceCharacter } from '../../providers/characters';
import { BriefDialog } from './BriefDialog';
import { errorText } from './character-text';
import { GearTypes } from './GearTypes';
import styles from './Characters.module.css';

export interface Wish { text: string; style: CharacterStyle | null; armor: boolean; gear: boolean }

/** What is being asked for. The page holds it, so a look at a character or at the gear loses nothing. */
export function useNewCharacter() {
  const [text, setText] = useState(''), [style, setStyle] = useState<CharacterStyle | ''>(''), [armor, setArmor] = useState(true), [gear, setGear] = useState(true), [types, setTypes] = useState<CharacterGearType[]>([]);
  const [asking, setAsking] = useState(false), [brief, setBrief] = useState<CharacterBrief | null>(null), [error, setError] = useState<unknown>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const take = useCallback((wish: Wish): void => {
    setText(wish.text);
    setStyle(wish.style ?? '');
    setArmor(wish.armor);
    setGear(wish.gear);
    setTypes([]);
  }, []);
  async function ask(): Promise<void> {
    const controller = new AbortController();
    abort.current = controller;
    setAsking(true);
    setError(null);
    try { setBrief(await priceCharacter({ kind: 'character', text: text.trim(), armor, gear, ...(gear && types.length ? { types } : {}), ...(style ? { style } : {}) }, controller.signal)); }
    catch (e) { if (!controller.signal.aborted) setError(e); }
    finally { if (!controller.signal.aborted) setAsking(false); }
  }
  return { text, setText, style, setStyle, armor, setArmor, gear, setGear, types, setTypes, asking, brief, setBrief, error, take, ask };
}

/** One sentence, what should come with it, and the price on the button. */
export function NewCharacter({ order, service, onOrdered, onUnsure, onOpenAccount }: { order: ReturnType<typeof useNewCharacter>; service: CharacterService | null; onOrdered: () => void; onUnsure: () => void; onOpenAccount: () => void }) {
  const { t } = useI18n();
  const { text, setText, style, setStyle, armor, setArmor, gear, setGear, types, setTypes, asking, brief, setBrief, error, ask } = order;
  const prices = service?.prices, total = prices ? prices.hero + (armor ? prices.armor : 0) + (gear ? prices.gear : 0) : null;
  const examples = [t('characters.example1'), t('characters.example2'), t('characters.example3')];
  const toggle = (on: boolean, set: (v: boolean) => void, label: string, credits: number | undefined) =>
    <label className={`${styles.option} ${on ? styles.optionOn : ''}`}><input type="checkbox" checked={on} disabled={asking} onChange={e => set(e.target.checked)} /><span>{label}</span>{credits !== undefined && <em>{credits}</em>}</label>;

  return <section className={styles.box} aria-label={t('characters.new')}>
    <h2>{t('characters.new')}</h2>
    <Textarea className={styles.words} rows={2} maxLength={600} value={text} disabled={asking} placeholder={t('characters.placeholder')} aria-label={t('characters.placeholder')} onChange={e => setText(e.target.value)} data-testid="character-text" />
    {!text && <div className={styles.examples}>{examples.map(x => <button key={x} type="button" onClick={() => setText(x)}>{x}</button>)}</div>}
    <div className={styles.options}>
      <span className={`${styles.option} ${styles.optionOn}`}><span>{t('characters.part.hero')}</span>{prices && <em>{prices.hero}</em>}</span>
      {toggle(armor, setArmor, t('characters.part.armor'), prices?.armor)}
      {toggle(gear, setGear, t('characters.part.gear'), prices?.gear)}
      <label className={styles.styleField}><span>{t('characters.style')}</span>
        <Select value={style} disabled={asking} onChange={e => setStyle(e.target.value as CharacterStyle | '')}>
          <option value="">{t('characters.style.auto')}</option>
          {CHARACTER_STYLES.map(s => <option key={s} value={s}>{t(s === 'ink' ? 'characters.style.ink' : 'characters.style.cute')}</option>)}
        </Select></label>
      <Button variant="primary" className={styles.make} disabled={asking || text.trim().length < 2 || !service || service.paused} onClick={() => void ask()} data-testid="character-price">
        {asking ? t('characters.understanding') : total === null ? t('characters.make') : t('characters.makeFor', { credits: total })}
      </Button>
    </div>
    {gear && <GearTypes value={types} disabled={asking} onChange={setTypes} />}
    {asking && <p className={styles.hint} role="status">{t('characters.understandingHint')}</p>}
    {error !== null && <p className={styles.problem} role="alert">{errorText(t, error)}{characterErrorCode(error) === 'INSUFFICIENT_CREDITS' && <> <Button size="sm" onClick={onOpenAccount}>{t('generate.topUp')}</Button></>}</p>}
    {brief && <BriefDialog brief={brief} onClose={() => setBrief(null)} onOpenAccount={onOpenAccount} onUnsure={onUnsure} onOrdered={() => { setBrief(null); setText(''); onOrdered(); }} />}
  </section>;
}
