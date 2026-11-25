import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, SegmentedTabs } from '@openpixo/components';
import { isSampleCharacter, type CharacterGear, type CharacterSuggestion, type LocalCharacter } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { usePageNavigationReady } from '../../observability/navigation-timing';
import { characterErrorCode, dropCharacterSuggestion, fetchCharacterGear, fetchCharacters, fetchSampleCharacter, refreshCharactersStatus, useCharactersStatus } from '../../providers/characters';
import { navigate } from '../../router';
import { formatCredits } from '../account/account-format';
import { Icon } from '../Icon';
import theme from '../generate/studio-theme.module.css';
import { CharacterCard } from './CharacterCard';
import { CharacterDetail } from './CharacterDetail';
import { errorText, isWorking } from './character-text';
import { GearShelf } from './GearShelf';
import { NewCharacter, useNewCharacter } from './NewCharacter';
import styles from './Characters.module.css';

export interface PageGame { id: string; name: string; updatedAt?: number | string | undefined; createdAt?: number | string | undefined }

/** Work goes on in the cloud whether the page is open or not; this is only how often it is looked at. */
const LOOK_MS = 3_000;
/** A service that did not answer, or is paused, is asked again this often. */
const SERVICE_MS = 30_000;

/**
 * 角色: finished characters whose gear can be changed, for every game. They live with the account and
 * keep growing (gear, motions, the games they are in), which is why they are not results of 生成.
 */
export function CharactersPage({ characterId, games, onOpenAccount, onOpenProject }: {
  characterId: string | undefined;
  games: readonly PageGame[];
  onOpenAccount: () => void;
  onOpenProject: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const status = useCharactersStatus(), signedIn = Boolean(status?.signedIn);
  const { credits } = useOpenPixoCredits(signedIn);
  const [characters, setCharacters] = useState<LocalCharacter[] | null>(null);
  const [suggestions, setSuggestions] = useState<CharacterSuggestion[]>([]);
  const [gear, setGear] = useState<CharacterGear | null>(null), [sample, setSample] = useState<LocalCharacter | null | undefined>(undefined);
  const [failed, setFailed] = useState<string | null>(null);
  const [section, setSection] = useState<'characters' | 'gear'>('characters');
  const order = useNewCharacter(), [suggestion, setSuggestion] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const available = Boolean(status?.available);
  // a page without the sample is still a page; undefined until it is known
  const readSample = useCallback(async () => {
    try { const next = await fetchSampleCharacter(locale); if (alive.current) setSample(next); } catch (error) { console.warn('[characters] could not read the sample:', error); if (alive.current) setSample(now => now ?? null); }
  }, [locale]);
  useEffect(() => { if (available) void readSample(); }, [available, readSample]);

  const readGear = useCallback(async () => {
    try { const next = await fetchCharacterGear(); if (alive.current) setGear(next); } catch (error) { console.warn('[characters] could not read the gear:', error); }
  }, []);
  // A list that was asked for before something was saved is older than what is shown.
  const saves = useRef({ open: 0, count: 0, skipped: false });
  const read = useCallback(async (): Promise<void> => {
    try {
      const before = saves.current.count, next = await fetchCharacters();
      if (!alive.current) return;
      if (saves.current.open) { saves.current.skipped = true; return; }
      if (before !== saves.current.count) return await read();
      setCharacters(next.characters);
      setSuggestions(next.suggestions);
      setFailed(null);
      if (!serviceKnown.current) void refreshCharactersStatus();
    } catch (error) {
      if (!alive.current) return;
      if (characterErrorCode(error) === 'ACCOUNT_SIGNED_OUT') void refreshCharactersStatus();
      else setFailed(errorText(t, error));
    }
  }, [t]);
  const hold = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    const s = saves.current;
    s.open++;
    try { return await work(); } finally {
      s.open--;
      s.count++;
      if (!s.open && s.skipped) { s.skipped = false; void read(); }
    }
  }, [read]);
  const serviceKnown = useRef(false);
  serviceKnown.current = Boolean(status?.service);
  const unserved = signedIn && (!status?.service || status.service.paused);
  useEffect(() => {
    if (!unserved) return;
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refreshCharactersStatus(); }, SERVICE_MS);
    return () => clearInterval(timer);
  }, [unserved]);
  useEffect(() => { if (signedIn) { void read(); void readGear(); } else { setCharacters(null); setGear(null); } }, [signedIn, read, readGear]);

  // while something is made, look again; what ended may have brought gear
  const working = characters?.filter(c => isWorking(c)).map(c => c.id).join() ?? '', before = useRef('');
  useEffect(() => {
    if (before.current && before.current !== working) void readGear();
    before.current = working;
    if (!working) return;
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void read(); }, LOOK_MS);
    return () => clearInterval(timer);
  }, [working, read, readGear]);

  const changed = useCallback((next: LocalCharacter) => setCharacters(all => all?.map(c => c.id === next.id ? next : c) ?? null), []);
  const games_ = useMemo(() => [...games].sort((a, b) => time(b) - time(a)), [games]);
  // the sample in another language is the same character: the address of one shows the one of now
  const wantsSample = characterId !== undefined && isSampleCharacter(characterId);
  const open = characterId ? characters?.find(c => c.id === characterId) : undefined, sampleOpen = !open && sample && wantsSample;
  usePageNavigationReady({ page: 'characters', visible: status !== null, ready: characters !== null, failure: failed !== null });

  const balance = credits ? <button type="button" className={styles.credits} onClick={onOpenAccount} data-testid="characters-credits">
    <span className={styles.creditsDot} aria-hidden="true" /><span>{t('generate.balance', { count: formatCredits(credits.available, locale) })}</span><span className={styles.topUp}>{t('generate.topUp')}</span>
  </button> : null;

  /** What a finished character is, before anything is paid for. */
  const tryOne = sample && <section data-testid="characters-sample">
    <h2 className={styles.heading}>{t('characters.sampleHeading')}</h2>
    <p className={styles.none}>{t('characters.sampleHint')}</p>
    <div className={styles.cards}><CharacterCard character={sample} sample onOpen={() => navigate({ kind: 'home', view: 'characters', characterId: sample.id })} onDeleted={() => {}} onChange={() => {}} /></div>
  </section>;

  let body;
  if (!status) body = <div className={styles.empty} aria-busy="true">{t('common.loading')}</div>;
  else if (!status.available) body = <div className={styles.empty}><p>{t('characters.unavailable')}</p></div>;
  else if (wantsSample && sample === undefined) body = <div className={styles.empty} aria-busy="true">{t('common.loading')}</div>;
  else if (sampleOpen) {
    return <main className={`${theme.studio} ${styles.page}`} data-theme="dark" data-testid="character-detail">
      <CharacterDetail key={sample.id} character={sample} sample gear={null} service={null} games={games_} balance={balance} onChange={setSample} onHold={work => work()} onRead={readSample} onGear={() => {}}
        onBack={() => navigate({ kind: 'home', view: 'characters' })} onOpenProject={onOpenProject} onOpenAccount={onOpenAccount} onDeleted={() => {}} />
    </main>;
  } else if (!status.signedIn) body = <><div className={styles.empty}><p>{t('characters.signedOut')}</p><Button variant="primary" onClick={onOpenAccount}>{t('characters.signIn')}</Button></div>{tryOne}</>;
  else if (!characters) body = failed ? <div className={styles.empty} role="alert"><p>{failed}</p><Button onClick={() => void read()}>{t('characters.retry')}</Button></div> : <div className={styles.empty} aria-busy="true">{t('common.loading')}</div>;
  else if (open) {
    return <main className={`${theme.studio} ${styles.page}`} data-theme="dark" data-testid="character-detail">
      <CharacterDetail key={open.id} character={open} gear={gear} service={status.service} games={games_} balance={balance} onChange={changed} onHold={hold} onRead={read} onGear={setGear}
        onBack={() => navigate({ kind: 'home', view: 'characters' })} onOpenProject={onOpenProject} onOpenAccount={onOpenAccount}
        onDeleted={id => { setCharacters(all => all?.filter(c => c.id !== id) ?? null); navigate({ kind: 'home', view: 'characters' }, { replace: true }); }} />
    </main>;
  } else if (section === 'gear') body = <GearShelf gear={gear} characters={characters} service={status.service} onGear={next => { setGear(next); void read(); }} onOrdered={read} onOpenAccount={onOpenAccount} />;
  else {
    body = <>
      {status.service?.paused && <p className={styles.notice} role="status">{t('characters.paused')}</p>}
      {failed && <p className={styles.notice} role="alert">{failed}</p>}
      <NewCharacter order={order} service={status.service} onOpenAccount={onOpenAccount} onUnsure={() => void read()} onOrdered={() => { if (suggestion) void dropCharacterSuggestion(suggestion).catch(() => {}); setSuggestion(null); void read(); }} />
      {suggestions.map(s => <div key={s.id} className={styles.suggestion}>
        <div><strong>{t('characters.suggested', { game: s.projectName })}</strong><p>{s.text}</p></div>
        <Button size="sm" variant="primary" onClick={() => { order.take(s); setSuggestion(s.id); }}>{t('characters.useSuggestion')}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setSuggestions(all => all.filter(x => x.id !== s.id)); void dropCharacterSuggestion(s.id).catch(() => {}); }}>{t('characters.dismiss')}</Button>
      </div>)}
      <h2 className={styles.heading}>{t('characters.mine')} <span>{characters.length || ''}</span></h2>
      {characters.length ? <div className={styles.cards}>{characters.map(c => <CharacterCard key={c.id} character={c} onOpen={() => navigate({ kind: 'home', view: 'characters', characterId: c.id })} onDeleted={() => setCharacters(all => all?.filter(x => x.id !== c.id) ?? null)} onChange={() => void read()} />)}</div>
        : <p className={styles.none}>{t('characters.none')}</p>}
      {(sample?.games.length || !characters.some(c => c.state === 'ready')) && tryOne}
    </>;
  }

  return <main className={`${theme.studio} ${styles.page}`} data-theme="dark" data-testid="characters-page">
    <div className={styles.scroll}>
      <header className={styles.header}>
        <h1>{t('characters.title')}</h1>
        {status?.signedIn && <SegmentedTabs label={t('characters.title')} value={section} onValueChange={v => setSection(v as 'characters' | 'gear')} items={[{ value: 'characters', label: t('characters.title') }, { value: 'gear', label: t('characters.gear') }]} />}
        <div className={styles.right}>{balance}</div>
      </header>
      {characterId && characters && !open && !wantsSample && <p className={styles.notice} role="status"><Icon name="info" size={14} /> {t('characters.gone')}</p>}
      {body}
    </div>
  </main>;
}

const time = (g: PageGame): number => { const v = g.updatedAt ?? g.createdAt; return typeof v === 'number' ? v : Date.parse(v ?? '') || 0; };
