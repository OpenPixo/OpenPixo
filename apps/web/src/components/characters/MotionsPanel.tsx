import { Button, Textarea } from '@openpixo/components';
import { CHARACTER_TUNING, type CharacterGear, type CharacterService, type CharacterTuning, type LocalCharacter } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { removeCharacterMotion, saveCharacterMotion } from '../../providers/characters';
import { Icon } from '../Icon';
import type { PixoCharacterPack } from '../../lib/characters/pixo-character';
import { inOrder, motionText } from './character-text';
import { jumps } from './stage';
import styles from './Characters.module.css';

type Slider = keyof typeof CHARACTER_TUNING;
const SLIDERS: Record<Slider, keyof Dict> = { speed: 'characters.tune.speed', windup: 'characters.tune.windup', power: 'characters.tune.power', jump: 'characters.tune.jump', stop: 'characters.tune.stop' };

/** The sliders that change something in this motion. */
export function slidersFor(pack: PixoCharacterPack | null, motion: string): Slider[] {
  const m = pack?.data.motions[motion];
  if (!pack || !m) return ['speed'];
  return [...(['speed'] as const), ...(m.hit === undefined ? [] : (['windup', 'power', 'stop'] as const)), ...(jumps(pack, motion) ? (['jump'] as const) : [])];
}
const differ = (a: CharacterTuning, b: CharacterTuning): boolean => (Object.keys(CHARACTER_TUNING) as Slider[]).some(k => (a[k] ?? 1) !== (b[k] ?? 1));

export function MotionsPanel({ character: c, pack, gear, service, motion, busy, asking, draft, onDraft, wish: text, onWish: setText, onPlay, onPreview, onSave, onHold, onChange, onProblem, onAsk }: {
  character: LocalCharacter;
  pack: PixoCharacterPack | null;
  gear: CharacterGear | null;
  service: CharacterService | null;
  motion: string;
  busy: boolean;
  asking: boolean;
  /** Sliders that were moved and not saved, and the words for a new motion: kept while another tab is open. */
  draft: CharacterTuning | undefined;
  onDraft: (values: CharacterTuning) => void;
  wish: string;
  onWish: (text: string) => void;
  onHold: <T>(work: () => Promise<T>) => Promise<T>;
  onPlay: (motion: string) => void;
  /** Null: as it is packed. */
  onPreview: (motion: string, tuning: CharacterTuning | null) => void;
  onSave: (motion: string, tuning: CharacterTuning) => Promise<unknown>;
  onChange: (c: LocalCharacter) => void;
  onProblem: (error: unknown) => void;
  onAsk: (text: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const current = c.motions.find(m => m.name === motion), saved = current?.tuning ?? {}, values = draft ?? saved;
  const set = (slider: Slider, value: number): void => { const next = { ...values, [slider]: value }; onDraft(next); onPreview(motion, next); };
  const more = (gear?.motions ?? []).filter(m => !c.motions.some(x => x.name === m.name)), price = service?.prices.motion;
  const act = (work: () => Promise<LocalCharacter>): void => { onHold(async () => { onChange(await work()); }).catch(onProblem); };

  return <div className={styles.panelBody}>
    <section><div className={styles.motionList}>
      {inOrder(c.motions).map(m => <div key={m.name} className={m.name === motion ? styles.motionOn : styles.motion}>
        <button type="button" aria-pressed={m.name === motion} onClick={() => onPlay(m.name)}>{motionText(t, m)}{differ(m.tuning, {}) && <Icon name="sliders" size={12} />}</button>
        {!m.builtIn && <Button size="icon" variant="ghost" aria-label={t('characters.takeMotion', { name: motionText(t, m) })} title={t('characters.takeMotion', { name: motionText(t, m) })} onClick={() => act(() => removeCharacterMotion(c.id, m.name))}><Icon name="close" size={12} /></Button>}
      </div>)}
    </div></section>
    {current && <section>
      <h3>{t('characters.tune')}<em>{t('characters.free')}</em></h3>
      {slidersFor(pack, motion).map(slider => <label key={slider} className={styles.slider}><span>{t(SLIDERS[slider])}</span>
        <input type="range" min={CHARACTER_TUNING[slider][0]} max={CHARACTER_TUNING[slider][1]} step={0.05} value={values[slider] ?? 1} onChange={e => set(slider, Number(e.target.value))} data-testid={`tune-${slider}`} /><output>{Math.round((values[slider] ?? 1) * 100)}%</output></label>)}
      <div className={styles.buttons}>
        <Button size="sm" variant="ghost" disabled={!differ(values, {})} onClick={() => { onDraft({}); onPreview(motion, {}); }}>{t('characters.tuneReset')}</Button>
        <Button size="sm" variant="primary" disabled={!differ(values, saved)} onClick={() => void onSave(motion, values)} data-testid="tune-save">{t('common.save')}</Button>
      </div>
    </section>}
    {more.length > 0 && <section><h3>{t('characters.ownedMotions')}</h3>
      {more.map(m => <div key={m.name} className={styles.row}><span>{m.shown || m.name}</span><Button size="sm" onClick={() => act(() => saveCharacterMotion(c.id, m.name, {}))} data-testid={`motion-take-${m.name}`}>{t('characters.add')}</Button></div>)}
    </section>}
    <section>
      <h3>{t('characters.newMotion')}</h3>
      <Textarea rows={2} maxLength={600} value={text} disabled={asking} placeholder={t('characters.motionPlaceholder')} aria-label={t('characters.newMotion')} onChange={e => setText(e.target.value)} data-testid="motion-text" />
      <p className={styles.hint}>{t('characters.motionShared')}</p>
      <Button variant="primary" disabled={busy || asking || text.trim().length < 2 || !service || service.paused} onClick={() => void onAsk(text.trim())} data-testid="motion-price">{asking ? t('characters.understanding') : price === undefined ? t('characters.make') : t('characters.makeFor', { credits: price })}</Button>
    </section>
  </div>;
}
