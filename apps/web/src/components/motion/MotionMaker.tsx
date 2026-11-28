import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Textarea } from '@openpixo/components';
import { MOTION_NAME_MAX, MOTION_PICTURE_MAX_BYTES, MOTION_PICTURE_TYPES, MOTION_TEXT_MAX, type MotionJob, type MotionPortrait, type MotionService } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { fetchPortrait, motionErrorCode, orderMotion, paintPortrait, portraitPicture, refreshMotionStatus } from '../../providers/motion';
import { codeText, errorText } from './motion-text';
import styles from './Motion.module.css';

/** A portrait is looked at this often while it is painted. */
const PORTRAIT_MS = 2_000;

type Step = { kind: 'describe' } | { kind: 'painting'; portraitId: string } | { kind: 'portrait'; portrait: MotionPortrait } | { kind: 'confirm'; portrait: MotionPortrait; requestId: string };

/** The portrait being chosen, kept in this browser so that leaving the page does not lose one that counted against today. */
const KEPT = 'openpixo.motion.portrait';
const keep = (id: string | null): void => { try { if (id) localStorage.setItem(KEPT, id); else localStorage.removeItem(KEPT); } catch { /* storage is a convenience */ } };
const kept = (): string | null => { try { return localStorage.getItem(KEPT); } catch { return null; } };

/** What is being made. The page holds it, so a look at a character loses nothing. */
export function useMotionMaker() {
  const [text, setText] = useState(''), [picture, setPicture] = useState<File | null>(null), [step, setStep] = useState<Step>({ kind: 'describe' });
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const id = step.kind === 'painting' ? step.portraitId : step.kind === 'describe' ? null : step.portrait.id;
  const restored = useRef(false);
  useEffect(() => {
    // back on the page: the portrait that was being chosen, while it can still be ordered
    if (!restored.current) {
      restored.current = true;
      const was = kept();
      if (was && step.kind === 'describe') {
        void fetchPortrait(was).then(p => {
          if (p.state === 'painting') { setText(p.text); setStep({ kind: 'painting', portraitId: p.id }); }
          else if (p.state === 'ready' && !p.used && Date.parse(p.expiresAt) > Date.now()) { setText(p.text); setStep({ kind: 'portrait', portrait: p }); }
          else keep(null);
        }, () => undefined);
        return;
      }
    }
    keep(id);
  }, [id, step.kind]);
  return { text, setText, picture, setPicture, step, setStep, name, setName, busy, setBusy, error, setError };
}

const unsure = (error: unknown): boolean => { const code = motionErrorCode(error); return code === null || code === 'CLOUD_UNAVAILABLE'; };

/** Describe or show it → look at the portrait → take it or ask again → see the price → make it. */
export function MotionMaker({ maker, service, available, onOrdered, onOpenAccount }: {
  maker: ReturnType<typeof useMotionMaker>;
  service: MotionService | null;
  /** The user's credits; null while unknown. */
  available: number | null;
  onOrdered: (job: MotionJob) => void;
  onOpenAccount: () => void;
}) {
  const { t } = useI18n();
  const { text, setText, picture, setPicture, step, setStep, name, setName, busy, setBusy, error, setError } = maker;
  const [preview, setPreview] = useState<string | null>(null), [credits, setCredits] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!picture) { setPreview(null); return; }
    const url = URL.createObjectURL(picture);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [picture]);

  // while it is painted, look again
  const painting = step.kind === 'painting' ? step.portraitId : null;
  useEffect(() => {
    if (!painting) return;
    const timer = setInterval(() => {
      void fetchPortrait(painting).then(p => {
        if (!alive.current || p.state === 'painting') return;
        if (p.state === 'ready') setStep({ kind: 'portrait', portrait: p });
        else { setError(codeText(t, p.errorCode)); setStep({ kind: 'describe' }); }
      }, (e: unknown) => { if (alive.current && !unsure(e)) { setError(errorText(t, e)); setStep({ kind: 'describe' }); } });
    }, PORTRAIT_MS);
    return () => clearInterval(timer);
  }, [painting, setError, setStep, t]);

  const paint = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setCredits(false);
    try {
      const portrait = await paintPortrait(text.trim(), picture, crypto.randomUUID());
      if (!alive.current) return;
      setStep(portrait.state === 'ready' ? { kind: 'portrait', portrait } : { kind: 'painting', portraitId: portrait.id });
      void refreshMotionStatus();
    } catch (e) { if (alive.current) setError(errorText(t, e)); }
    finally { if (alive.current) setBusy(false); }
  }, [picture, setBusy, setError, setStep, t, text]);

  async function order(portrait: MotionPortrait, requestId: string): Promise<void> {
    setBusy(true);
    setError(null);
    setCredits(false);
    try {
      const job = await orderMotion(portrait.id, name.trim(), requestId);
      if (!alive.current) return;
      setStep({ kind: 'describe' });
      setText('');
      setPicture(null);
      setName('');
      onOrdered(job);
    } catch (e) {
      if (!alive.current) return;
      setError(errorText(t, e));
      setCredits(motionErrorCode(e) === 'INSUFFICIENT_CREDITS');
      // the same id again cannot order twice; anything else needs a new one
      if (!unsure(e)) setStep({ kind: 'confirm', portrait, requestId: crypto.randomUUID() });
    } finally { if (alive.current) setBusy(false); }
  }

  function choose(file: File | undefined): void {
    if (!file) return;
    if (!(MOTION_PICTURE_TYPES as readonly string[]).includes(file.type) || file.size > MOTION_PICTURE_MAX_BYTES) { setError(t('motion.pictureInvalid')); return; }
    setError(null);
    setPicture(file);
  }

  const paused = !service || service.paused, left = service?.portraitsLeft ?? 0, price = service?.price ?? null;
  const problem = error && <p className={styles.problem} role="alert">{error}{credits && <> <Button size="sm" onClick={onOpenAccount}>{t('generate.topUp')}</Button></>}</p>;

  if (step.kind === 'describe') {
    const enough = text.trim().length >= 2 || Boolean(picture);
    return <section className={styles.box} aria-label={t('motion.describe')} data-testid="motion-describe">
      <h2>{t('motion.describe')}</h2>
      <Textarea className={styles.words} rows={2} maxLength={MOTION_TEXT_MAX} value={text} disabled={busy} placeholder={t('motion.placeholder')} aria-label={t('motion.describe')} onChange={e => setText(e.target.value)} data-testid="motion-text" />
      <div className={styles.options}>
        <input ref={fileInput} type="file" hidden accept={MOTION_PICTURE_TYPES.join(',')} onChange={e => { choose(e.target.files?.[0]); e.target.value = ''; }} data-testid="motion-picture-input" />
        {preview ? <span className={styles.pictureChip}><img src={preview} alt="" /><span>{picture?.name}</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPicture(null)}>{t('motion.pictureRemove')}</Button></span>
          : <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>{t('motion.picture')}</Button>}
        <span className={styles.hint}>{t('motion.pictureHint')}</span>
        <span className={styles.spacer} />
        {service && <span className={styles.hint}>{t('motion.portraitsLeft', { count: left })}</span>}
        <Button variant="primary" disabled={busy || !enough || paused || left < 1} onClick={() => void paint()} data-testid="motion-paint">{busy ? t('motion.painting') : t('motion.paint')}</Button>
      </div>
      <p className={styles.hint}>{t('motion.portraitFree')}</p>
      {problem}
    </section>;
  }

  if (step.kind === 'painting') {
    return <section className={styles.box} aria-label={t('motion.painting')} data-testid="motion-painting">
      <div className={styles.portraitRow}>
        <div className={`${styles.portrait} ${styles.portraitPainting}`}>{preview && <img src={preview} alt="" />}</div>
        <div className={styles.portraitSide}>
          <h2 role="status">{t('motion.painting')}</h2>
          <p className={styles.hint}>{t('motion.paintingHint')}</p>
          <p className={styles.hint}>{t('motion.paintingBackHint')}</p>
          <div className={styles.actions}><Button variant="ghost" onClick={() => setStep({ kind: 'describe' })} data-testid="motion-painting-back">{t('motion.back')}</Button></div>
        </div>
      </div>
      {problem}
    </section>;
  }

  const { portrait } = step;
  if (step.kind === 'portrait') {
    // after a reload the picture is not here any more: painting again without it would paint someone else
    const lost = portrait.fromPicture && !picture;
    const again = (): void => { if (lost) { setStep({ kind: 'describe' }); setError(t('motion.pictureAgain')); } else void paint(); };
    return <section className={styles.box} aria-label={t('motion.portraitAlt')} data-testid="motion-portrait">
      <div className={styles.portraitRow}>
        <div className={styles.portrait}><img src={portraitPicture(portrait.id)} alt={t('motion.portraitAlt')} /></div>
        <div className={styles.portraitSide}>
          <h2>{t('motion.portraitQuestion')}</h2>
          <p className={styles.hint}>{t('motion.portraitFree')}</p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={() => setStep({ kind: 'confirm', portrait, requestId: crypto.randomUUID() })} data-testid="motion-use">{t('motion.usePortrait')}</Button>
            <Button variant="secondary" disabled={busy || paused || left < 1} onClick={again} data-testid="motion-again">{t('motion.tryAgainLeft', { count: left })}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setStep({ kind: 'describe' })}>{t('motion.back')}</Button>
          </div>
        </div>
      </div>
      {problem}
    </section>;
  }

  const named = name.trim().length > 0 && [...name.trim()].length <= MOTION_NAME_MAX, short = price !== null && available !== null && available < price;
  return <section className={styles.box} aria-label={t('motion.confirm')} data-testid="motion-confirm">
    <div className={styles.portraitRow}>
      <div className={styles.portrait}><img src={portraitPicture(portrait.id)} alt={t('motion.portraitAlt')} /></div>
      <div className={styles.portraitSide}>
        <h2>{t('motion.confirm')}</h2>
        <label className={styles.field}><span>{t('motion.nameLabel')}</span>
          <Input value={name} maxLength={MOTION_NAME_MAX} disabled={busy} placeholder={t('motion.namePlaceholder')} onChange={e => setName(e.target.value)} data-testid="motion-name" /></label>
        {price !== null && <p className={styles.price}>{t('motion.price', { credits: price })}{available !== null && <span> · {t('motion.available', { count: available })}</span>}</p>}
        <p className={styles.hint}>{t('motion.priceNote')}</p>
        <p className={styles.hint}>{t('motion.makingHint')}</p>
        <div className={styles.actions}>
          {short ? <Button variant="primary" onClick={onOpenAccount}>{t('generate.topUp')}</Button>
            : <Button variant="primary" disabled={busy || !named || paused || price === null} onClick={() => void order(portrait, step.requestId)} data-testid="motion-make">{busy ? t('motion.ordering') : t('motion.make', { credits: price ?? 0 })}</Button>}
          <Button variant="ghost" disabled={busy} onClick={() => setStep({ kind: 'portrait', portrait })}>{t('motion.back')}</Button>
        </div>
      </div>
    </div>
    {problem}
  </section>;
}
