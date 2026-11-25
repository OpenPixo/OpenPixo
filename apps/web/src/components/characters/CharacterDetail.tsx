import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, ConfirmDialog, Input, SegmentedTabs } from '@openpixo/components';
import type { CharacterBrief, CharacterBriefRequest, CharacterGear, CharacterOutfit, CharacterService, CharacterTuning, CharacterUpdate, LocalCharacter } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import { deleteCharacter, installCharacter, packCharacter, priceCharacter, saveCharacterMotion, tuneCharacter, uninstallCharacter, updateCharacter } from '../../providers/characters';
import { Icon } from '../Icon';
import { PixoCharacter, type PixoCharacterPack, type PixoSlot, type PixoWear } from '../../lib/characters/pixo-character';
import { BriefDialog } from './BriefDialog';
import { codeText, errorText, GUARD, inOrder, isWorking, motionText, stateText } from './character-text';
import type { PageGame } from './CharactersPage';
import { GearDialog } from './GearDialog';
import { MotionsPanel } from './MotionsPanel';
import { FRAMES, loadPack, run } from './stage';
import { Wardrobe } from './Wardrobe';
import styles from './Characters.module.css';

const ZOOMS = [1, 1.5, 2.1];
const GROUNDS = ['studio', 'checker', 'outdoor'] as const;
type Ground = (typeof GROUNDS)[number];
const TUNE_MS = 220;

/** What can be seen of an outfit in a package. A preview is made from what is saved, which can be less than the package on the stage has. */
export const wornIn = (pack: Pick<PixoCharacterPack, 'tracks'>, wear: PixoWear): PixoWear => Object.fromEntries(Object.entries(wear).filter(([slot, id]) =>
  slot === 'head' ? pack.tracks.has('head') : slot === 'weapon' ? pack.tracks.has(id) && pack.tracks.has(`armF${id.replace('weapon', '')}`) : slot === 'cape' || slot === 'shield' ? pack.tracks.has(id) : true));

export function CharacterDetail({ character: c, sample, gear, service, games, balance, onChange, onHold, onRead, onGear, onBack, onDeleted, onOpenProject, onOpenAccount }: {
  character: LocalCharacter;
  /** The free sample: it can be dressed, played and put into games, and nothing of it can be changed. */
  sample?: boolean;
  gear: CharacterGear | null;
  service: CharacterService | null;
  games: readonly PageGame[];
  balance: ReactNode;
  onChange: (c: LocalCharacter) => void;
  /** Runs something that saves; until it is done, lists that were asked for earlier do not count. */
  onHold: <T>(work: () => Promise<T>) => Promise<T>;
  onRead: () => Promise<void>;
  onGear: (g: CharacterGear) => void;
  onBack: () => void;
  onDeleted: (id: string) => void;
  onOpenProject: (id: string) => void;
  onOpenAccount: () => void;
}) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null), actor = useRef<PixoCharacter | null>(null), bar = useRef<HTMLDivElement>(null);
  const [pack, setPack] = useState<PixoCharacterPack | null>(null);
  const [wear, setWear] = useState<PixoWear | null>(null), [motion, setMotion] = useState('idle'), [paused, setPaused] = useState(false), [zoom, setZoom] = useState(0), [ground, setGround] = useState<Ground>('studio');
  const [tab, setTab] = useState<'wardrobe' | 'motions' | 'games'>('wardrobe'), [notice, setNotice] = useState<string | null>(null), [problem, setProblem] = useState<string | null>(null);
  const [brief, setBrief] = useState<CharacterBrief | null>(null), [asking, setAsking] = useState(false), [gearOpen, setGearOpen] = useState(false), [deleting, setDeleting] = useState(false), [renaming, setRenaming] = useState(false), [name, setName] = useState(c.name);
  const working = isWorking(c), packing = working && c.job?.kind === 'pack';

  /** What is previewed: it holds one motion, and only the weapon and the cape that were worn. */
  const previewed = useRef<{ motion: string; values: CharacterTuning } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CharacterTuning>>({}), [motionWish, setMotionWish] = useState('');
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // --- The stage
  useEffect(() => {
    let left = false;
    loadPack(c).then(next => { if (!left) setPack(next); }, e => { if (!left) setProblem(errorText(t, e)); });
    return () => { left = true; };
  }, [c.id, c.revision, t]);
  // a new package keeps what was worn and played, as far as it still has it
  useEffect(() => {
    if (!pack) return;
    const next = pack.create(), before = actor.current;
    if (before) {
      next.wear = Object.fromEntries(Object.entries(before.wear).filter(([slot, id]) => pack.data.items[slot as PixoSlot]?.includes(id)));
      if (pack.data.motions[before.motion]) next.motion = before.motion;
      next.paused = before.paused;
    }
    next.onEnd = () => { const a = actor.current; if (a) a.play(a.motion); };
    actor.current = next;
    previewed.current = null;
    setWear(next.wear);
    setMotion(next.motion);
    if (!canvas.current) return;
    return run(canvas.current, next, () => FRAMES.stage(ZOOMS[zoomRef.current]!, pack), () => { if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, next.time / next.info.seconds)})`; });
  }, [pack]);
  const play = useCallback((what: string) => {
    const a = actor.current;
    // a preview holds one motion only
    if (a && pack && !a.pack.data.motions[what]) a.pack = pack;
    a?.play(what);
    if (a) a.paused = false;
    setPaused(false);
    setMotion(what);
  }, [pack]);

  // --- Saving. Everything here is free.
  const act = useCallback(async <T,>(work: () => Promise<T>): Promise<T | null> => {
    setProblem(null);
    try { return await work(); } catch (e) { setProblem(errorText(t, e)); return null; }
  }, [t]);
  const save = useCallback((change: CharacterUpdate) => act(() => onHold(async () => { const next = await updateCharacter(c.id, change); onChange(next); return next; })), [act, c.id, onChange, onHold]);
  // Outfits are sent as a whole list, so every change starts from the newest one and they are sent one after another.
  const latest = useRef(c);
  latest.current = c;
  const outfits = useRef({ list: c.outfits, open: 0, queue: Promise.resolve() });
  if (!outfits.current.open) outfits.current.list = c.outfits;
  const saveOutfits = useCallback((edit: (now: readonly CharacterOutfit[]) => CharacterOutfit[]): void => {
    const o = outfits.current;
    o.list = edit(o.list);
    o.open++;
    onChange({ ...latest.current, outfits: o.list });
    o.queue = o.queue.then(async () => {
      const done = await act(() => onHold(async () => { const next = await updateCharacter(c.id, { outfits: o.list }); onChange(o.open > 1 ? { ...next, outfits: o.list } : next); return next; }));
      o.open--;
      if (!done && !o.open) await onRead();
    });
  }, [act, c.id, onChange, onHold, onRead]);
  const packNow = useCallback(() => act(async () => { await packCharacter(c.id); await onRead(); }), [act, c.id, onRead]);
  const saveGear = async (ids: string[]): Promise<void> => {
    const next = await save({ gear: ids });
    if (!next) return;
    setGearOpen(false);
    // what was taken along can be tried on as soon as it is packed
    if (next.changed) await packNow();
  };
  const ask = (request: Omit<CharacterBriefRequest, 'characterId'>): Promise<void> => {
    setAsking(true);
    return act(async () => { setBrief(await priceCharacter({ ...request, characterId: c.id })); }).then(() => setAsking(false));
  };

  // --- Fine-tuning, shown before it is saved
  const tuning = useRef<{ timer: ReturnType<typeof setTimeout> | null; abort: AbortController | null }>({ timer: null, abort: null });
  const preview = useCallback((what: string, values: CharacterTuning | null, after = TUNE_MS) => {
    const state = tuning.current;
    if (state.timer) clearTimeout(state.timer);
    state.abort?.abort();
    previewed.current = values ? { motion: what, values } : null;
    const a = actor.current;
    if (!a || !pack) return;
    if (!values) { if (a.pack !== pack) { a.pack = pack; if (pack.data.motions[a.motion]) a.play(a.motion); } return; }
    state.timer = setTimeout(() => {
      const abort = new AbortController();
      state.abort = abort;
      tuneCharacter(c.id, what, values, a.wear, abort.signal).then(async ({ json, bin }) => {
        const shown = await pack.withMotion(json as Parameters<PixoCharacterPack['withMotion']>[0], bin);
        if (abort.signal.aborted || actor.current !== a) return;
        a.pack = shown;
        a.wear = wornIn(shown, a.wear);
        a.motion = what;
        a.play(what);
        setWear(a.wear);
        setMotion(what);
      }).catch(e => { if (!abort.signal.aborted) setProblem(errorText(t, e)); });
    }, after);
  }, [c.id, pack, t]);
  const dress = useCallback((next: PixoWear) => {
    const a = actor.current, now = previewed.current;
    if (a) {
      // the package has every piece at once; the preview follows with what is worn now
      if (pack && a.pack !== pack && pack.data.motions[a.motion]) a.pack = pack;
      a.wear = next;
    }
    setWear(next);
    if (now) preview(now.motion, now.values, 0);
  }, [pack, preview]);
  useEffect(() => () => { const { timer, abort } = tuning.current; if (timer) clearTimeout(timer); abort?.abort(); }, []);
  // what was saved stays on the stage, although the package does not hold it yet
  const saveTuning = (what: string, values: CharacterTuning) => act(() => onHold(async () => { onChange(await saveCharacterMotion(c.id, what, values)); return true; }))
    .then(done => { if (done) setDrafts(({ [what]: _, ...rest }) => rest); });
  const choose = (what: string): void => {
    const draft = drafts[what], packed = Boolean(pack?.data.motions[what]);
    // what the package does not hold, or may hold differently, is asked for
    preview(what, draft ?? (c.changed || !packed ? c.motions.find(m => m.name === what)?.tuning ?? {} : null), 0);
    if (packed) play(what); else setMotion(what);
  };

  // --- Games
  const [installing, setInstalling] = useState<string | null>(null);
  const install = (projectId: string): Promise<unknown> => {
    setInstalling(projectId);
    setNotice(null);
    return act(async () => {
      // the daemon packs what was saved first
      const done = await installCharacter(projectId, c.id);
      setNotice(done.playerState === 'edited' ? t('characters.installedEdited', { player: done.player }) : t('characters.installed', { folder: done.folder }));
      await onRead();
    }).then(() => setInstalling(null));
  };

  // a shield brings a motion of its own along
  const motions = useMemo(() => inOrder(pack?.data.motions[GUARD] && !c.motions.some(m => m.name === GUARD) ? [...c.motions, { name: GUARD, builtIn: true, shown: '', tuning: {} }] : c.motions), [c.motions, pack]);
  const inGame = new Set(c.games.map(g => g.projectId));

  return <>
    <header className={styles.detailHeader}>
      <Button variant="ghost" size="sm" onClick={onBack} data-testid="character-back"><Icon name="arrow-left" size={14} /> {t('characters.title')}</Button>
      {renaming ? <form className={styles.rename} onSubmit={e => { e.preventDefault(); void save({ name: name.trim() }).then(next => { if (next) setRenaming(false); }); }}>
        <Input autoFocus value={name} maxLength={60} aria-label={t('characters.name')} onChange={e => setName(e.target.value)} /><Button size="sm" type="submit" variant="primary" disabled={!name.trim()}>{t('common.save')}</Button><Button size="sm" variant="ghost" onClick={() => { setName(c.name); setRenaming(false); }}>{t('common.cancel')}</Button>
      </form> : <h1>{c.name} {!sample && <Button variant="ghost" size="icon" aria-label={t('characters.rename')} onClick={() => setRenaming(true)}><Icon name="pencil" size={13} /></Button>}</h1>}
      <span className={styles.cardMeta}>{t(sample ? 'characters.sample' : c.style === 'ink' ? 'characters.style.ink' : 'characters.style.cute')}</span>
      <div className={styles.right}>{balance}{sample ? <Button variant="primary" size="sm" onClick={onBack} data-testid="character-sample-own">{t('characters.sampleOwn')}</Button>
        : <Button variant="ghost" size="sm" disabled={working} onClick={() => setDeleting(true)}><Icon name="trash" size={14} /> {t('characters.delete')}</Button>}</div>
    </header>
    <div className={styles.detail}>
      <section className={styles.stage} data-ground={ground} aria-label={c.name}>
        <div className={styles.stageTop}>
          <SegmentedTabs label={t('characters.ground')} value={ground} onValueChange={v => setGround(v as Ground)} items={GROUNDS.map(g => ({ value: g, label: t(g === 'studio' ? 'characters.ground.studio' : g === 'checker' ? 'characters.ground.checker' : 'characters.ground.outdoor') }))} />
          <div><Button variant="ghost" size="icon" aria-label={t('characters.zoomOut')} disabled={zoom === 0} onClick={() => setZoom(z => z - 1)}><Icon name="zoom-out" size={16} /></Button><Button variant="ghost" size="icon" aria-label={t('characters.zoomIn')} disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(z => z + 1)}><Icon name="zoom-in" size={16} /></Button></div>
        </div>
        <canvas ref={canvas} className={styles.stageCanvas} data-testid="character-stage" data-motion={motion} data-ready={pack ? 'true' : 'false'} role="img" aria-label={t('characters.stageLabel', { name: c.name })} />
        {!pack && !problem && <p className={styles.stageWait} role="status">{t('common.loading')}</p>}
        <div className={styles.messages}>
          {working && c.job && <p className={styles.notice} role="status">{packing ? t('characters.packing') : `${stateText(t, c.job.state)}…`}</p>}
          {!working && c.job?.state === 'failed' && <p className={styles.notice} role="status">{codeText(t, c.job.errorCode)}</p>}
          {!working && c.changed && <p className={styles.notice} role="status">{t('characters.unpacked')} <Button size="sm" onClick={() => void packNow()} data-testid="character-pack">{t('characters.pack')}</Button></p>}
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          {problem && <p className={styles.problem} role="alert">{problem}</p>}
        </div>
        <div className={styles.track} aria-hidden="true"><div ref={bar} /></div>
        <div className={styles.playbar}>
          <Button size="icon" aria-label={t(paused ? 'characters.play' : 'characters.pause')} onClick={() => { const next = !paused; if (actor.current) actor.current.paused = next; setPaused(next); }}><Icon name={paused ? 'play' : 'pause'} size={14} /></Button>
          {motions.map(m => <button key={m.name} type="button" className={m.name === motion ? styles.chipOn : styles.chip} aria-pressed={m.name === motion} onClick={() => choose(m.name)} data-testid={`character-motion-${m.name}`}>{motionText(t, m)}</button>)}
        </div>
      </section>
      <aside className={styles.panel}>
        <SegmentedTabs className={styles.tabs} label={c.name} value={tab} onValueChange={v => setTab(v as typeof tab)} items={[{ value: 'wardrobe', label: t('characters.wardrobe') }, ...(sample ? [] : [{ value: 'motions', label: t('characters.motions') }]), { value: 'games', label: t('characters.games'), ...(c.games.length ? { count: c.games.length } : {}) }]} />
        {tab === 'wardrobe' && wear && pack && <Wardrobe character={c} {...(sample ? { sample } : {})} pack={pack} wear={wear} onWear={dress} onOutfits={saveOutfits} onGear={() => { setProblem(null); setGearOpen(true); }} busy={working} />}
        {tab === 'motions' && <MotionsPanel character={c} pack={pack} gear={gear} service={service} motion={motion} busy={working} asking={asking} draft={drafts[motion]} onDraft={values => setDrafts(all => ({ ...all, [motion]: values }))} wish={motionWish} onWish={setMotionWish} onPlay={choose} onPreview={preview} onSave={saveTuning} onHold={onHold} onChange={onChange} onProblem={e => setProblem(errorText(t, e))} onAsk={text => ask({ kind: 'motion', text })} />}
        {tab === 'games' && <div className={styles.panelBody}>
          <p className={styles.hint}>{t('characters.gamesHint')}</p>
          {c.games.map(g => <div key={g.projectId} className={styles.row}><button type="button" className={styles.link} onClick={() => onOpenProject(g.projectId)}>{g.projectName}</button>
            {g.revision < c.revision || c.changed ? <Button size="sm" variant="primary" disabled={working || installing !== null} onClick={() => void install(g.projectId)}>{installing === g.projectId ? t('characters.installing') : t('characters.updateGame')}</Button> : <span className={styles.cardMeta}>{t('characters.upToDate')}</span>}
            <Button size="icon" variant="ghost" aria-label={t('characters.takeOut', { game: g.projectName })} disabled={installing !== null} onClick={() => void act(async () => { await uninstallCharacter(g.projectId, g.slug); await onRead(); })}><Icon name="trash" size={14} /></Button></div>)}
          {(games.length === 0 || games.some(g => !inGame.has(g.id))) && <h3>{t('characters.useInGame')}</h3>}
          {games.filter(g => !inGame.has(g.id)).map(g => <div key={g.id} className={styles.row}><span>{g.name}</span><Button size="sm" disabled={working || installing !== null} onClick={() => void install(g.id)} data-testid={`character-install-${g.id}`}>{installing === g.id ? t('characters.installing') : t('characters.putIn')}</Button></div>)}
          {games.length === 0 && <p className={styles.hint}>{t('characters.noGames')}</p>}
        </div>}
      </aside>
    </div>
    {gearOpen && <GearDialog character={c} gear={gear} service={service} busy={working} asking={asking} problem={problem} onClose={() => setGearOpen(false)} onSave={saveGear} onAsk={ask} onGear={onGear} />}
    {brief && <BriefDialog brief={brief} onClose={() => setBrief(null)} onOpenAccount={onOpenAccount} onUnsure={() => void onRead()} onOrdered={() => { if (brief.kind === 'motion') setMotionWish(''); setBrief(null); setGearOpen(false); void onRead(); }} />}
    <ConfirmDialog open={deleting} title={t('characters.deleteTitle', { name: c.name })} confirmLabel={t('characters.delete')} cancelLabel={t('common.cancel')} destructive onCancel={() => setDeleting(false)}
      onConfirm={() => { setDeleting(false); void act(() => deleteCharacter(c.id)).then(done => { if (done) onDeleted(c.id); }); }}>{t('characters.deleteBody')}</ConfirmDialog>
  </>;
}
