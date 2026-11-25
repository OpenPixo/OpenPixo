import { useRef, useState } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from '@openpixo/components';
import type { CharacterBrief, CharacterJob } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { characterErrorCode, orderCharacter } from '../../providers/characters';
import { errorText, partText } from './character-text';
import theme from '../generate/studio-theme.module.css';
import styles from './Characters.module.css';

/** What was understood, what it costs, and the one click that spends. */
export function BriefDialog({ brief, onClose, onOrdered, onUnsure, onOpenAccount }: { brief: CharacterBrief; onClose: () => void; onOrdered: (job: CharacterJob) => void; /** There was no answer, so it may have been ordered: what there is has to be read again. */ onUnsure: () => void; onOpenAccount: () => void }) {
  const { t } = useI18n();
  const [ordering, setOrdering] = useState(false), [error, setError] = useState<unknown>(null);
  // a lost answer is asked for again under the same id, so nothing is ordered twice
  const requestId = useRef(crypto.randomUUID());
  const unsure = error !== null && [null, 'CLOUD_UNAVAILABLE'].includes(characterErrorCode(error));
  const { shown } = brief, enough = brief.available >= brief.credits;
  const rows = ([['characters.look', shown.look], ['characters.clothes', shown.clothes], ['characters.colours', shown.colours], ['characters.gearText', shown.gear]] as const).filter(([, v]) => v);
  async function order() {
    setOrdering(true);
    setError(null);
    try { onOrdered(await orderCharacter(brief.briefId, requestId.current)); } catch (e) { setError(e); setOrdering(false); onUnsure(); }
  }
  return <Dialog className={`${theme.studio} ${styles.dialog}`} data-theme="dark" ariaLabel={t('characters.confirm')} onClose={() => { if (!ordering) onClose(); }}>
    <DialogHeader><DialogTitle>{brief.name && brief.kind === 'character' ? brief.name : t('characters.confirm')}</DialogTitle></DialogHeader>
    <DialogBody>
      {rows.length > 0 && <dl className={styles.facts}>
        {rows.map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}
        {brief.style && <div><dt>{t('characters.style')}</dt><dd>{t(brief.style === 'ink' ? 'characters.style.ink' : 'characters.style.cute')}</dd></div>}
      </dl>}
      {shown.note && <p className={styles.hint}>{shown.note}</p>}
      <ul className={styles.prices}>{brief.parts.map(p => <li key={p.part}><span>{partText(t, p.part)}</span><b>{p.credits}</b></li>)}<li className={styles.sum}><span>{t('characters.total')}</span><b>{t('characters.credits', { count: brief.credits })}</b></li></ul>
      <p className={styles.hint}>{t('characters.promise')} {t('characters.balance', { count: brief.available })}</p>
      {error !== null && <p className={styles.problem} role="alert">{unsure ? t('characters.error.maybe') : errorText(t, error)}</p>}
    </DialogBody>
    <DialogFooter>
      <Button variant="ghost" disabled={ordering} onClick={onClose}>{t(brief.kind === 'fit' ? 'common.cancel' : 'characters.changeWords')}</Button>
      {enough ? <Button variant="primary" disabled={ordering} onClick={() => void order()} data-testid="character-order">{ordering ? t('characters.ordering') : t('characters.orderFor', { credits: brief.credits })}</Button>
        : <Button variant="primary" onClick={onOpenAccount}>{t('generate.topUp')}</Button>}
    </DialogFooter>
  </Dialog>;
}
