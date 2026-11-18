import { useCallback, useEffect, useId, useState } from 'react';
import { Button, ConfirmDialog, Eyebrow, Input, SegmentedTabs, VisuallyHidden } from '@openpixo/components';
import type { PublishedGameEntry, PublishedGamesResponse } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { copyToClipboard } from '../../lib/copy-to-clipboard';
import { usePageNavigationReady } from '../../observability/navigation-timing';
import { fetchPublishedGames, PublishRequestError, removeShare, updateShareRoomsLimit } from '../../providers/publish';
import { openExternalUrl } from '../../providers/registry';
import { Icon } from '../Icon';
import { nextMonthStart } from '../game/ShareOnline';
import { filterGames, hoursLeft, ONLINE_WARN_SHARE, onlineUsedPercent, parseLimit, playerHours, summarize, tileLetter, tileTone,
  type GameHubFilter } from './game-hub-state';
import styles from './GameHubView.module.css';

export interface GameHubViewProps {
  onOpenProject: (projectId: string) => void;
  /** Settings › Account & credits, for signing in and plans. */
  onOpenAccount: () => void;
}

type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; list: PublishedGamesResponse };

/**
 * 游戏管理: every game the creator shared, single-player and multiplayer, in one list, said in
 * plain words. Counts the creator does not need (requests, bytes, link ids, versions) stay out of
 * sight; the page only speaks up about the plan's allowances when something needs doing. The Share
 * dialog inside a game is still where it is published or updated.
 */
export function GameHubView({ onOpenProject, onOpenAccount }: GameHubViewProps) {
  const { t, locale } = useI18n();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [filter, setFilter] = useState<GameHubFilter>('all');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad(previous => previous.state === 'ready' ? previous : { state: 'loading' });
    fetchPublishedGames(controller.signal)
      .then(list => setLoad({ state: 'ready', list }))
      .catch(error => { if (!(error instanceof DOMException && error.name === 'AbortError')) setLoad({ state: 'failed' }); });
    return () => controller.abort();
  }, [reload]);
  const refresh = useCallback(() => setReload(value => value + 1), []);

  usePageNavigationReady({ page: 'game-hub', visible: load.state !== 'loading', ready: load.state === 'ready', failure: load.state === 'failed' });

  const number = (value: number) => new Intl.NumberFormat(locale).format(value);

  let body;
  if (load.state === 'loading') {
    body = <div className={styles.skeleton} aria-busy="true"><VisuallyHidden>{t('gameHub.loading')}</VisuallyHidden><div /><div /></div>;
  } else if (load.state === 'failed') {
    body = <div className={styles.empty} role="alert"><p>{t('gameHub.failed')}</p><Button onClick={refresh}>{t('gameShare.retry')}</Button></div>;
  } else if (!load.list.available) {
    body = load.list.unavailableReason === 'signed_out'
      ? <div className={styles.empty}><p>{t('gameHub.signedOut')}</p><Button variant="primary" onClick={onOpenAccount}>{t('gameShare.signIn')}</Button></div>
      : <div className={styles.empty}><p>{t('gameHub.noCloud')}</p></div>;
  } else {
    const { list } = load;
    const summary = summarize(list);
    const shown = filterGames(list.games, filter);
    const multiplayerCount = filterGames(list.games, 'multiplayer').length;
    const orphanCount = filterGames(list.games, 'orphans').length;
    const free = summary.roomsFree ? hoursLeft(summary.roomsFree.usedMinutes, summary.roomsFree.totalMinutes) : null;
    const onlinePercent = summary.online ? onlineUsedPercent(summary.online) : 0;
    const liveCount = summary.plan?.live ?? list.games.filter(entry => entry.game.state !== 'removed').length;
    const notices: Array<{ key: string; text: string; action?: { label: string; run: () => void } }> = [];
    if (summary.planRequired) notices.push({ key: 'plan', text: t('gameHub.noPlan'), action: { label: t('gameOnline.upgrade'), run: onOpenAccount } });
    if (summary.online && summary.online.state === 'read-only') {
      notices.push({ key: 'online', text: t('gameHub.onlineFull', { date: new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(nextMonthStart(summary.online.month))) }),
        action: { label: t('gameOnline.upgrade'), run: onOpenAccount } });
    } else if (summary.online && onlinePercent >= ONLINE_WARN_SHARE * 100) {
      notices.push({ key: 'online', text: t('gameHub.onlineAlmostFull', { percent: number(onlinePercent) }), action: { label: t('gameOnline.upgrade'), run: onOpenAccount } });
    }
    if (!summary.roomsPaused && free && free.left === 0 && free.total > 0) notices.push({ key: 'rooms', text: t('gameHub.freeTimeUsed') });

    body = <>
      <section className={styles.summary} aria-label={t('gameHub.summaryLabel')}>
        <div className={styles.fact}>
          <Icon name="globe" size={18} />
          <div>
            <strong>{t('gameHub.factShared', { count: number(liveCount) })}</strong>
            <span>{summary.plan ? t('gameHub.factPlan', { max: number(summary.plan.max) }) : t('gameHub.factNoPlan')}</span>
            {summary.plan ? <span className={styles.meter} aria-hidden="true"><span style={{ width: `${Math.min(100, (summary.plan.live / Math.max(1, summary.plan.max)) * 100)}%` }} /></span> : null}
          </div>
        </div>
        <div className={styles.fact}>
          <Icon name="play" size={18} />
          <div>
            <strong>{t('gameHub.factPlays', { count: number(summary.totalPlays) })}</strong>
            <span>{t('gameHub.factPlaysHint')}</span>
          </div>
        </div>
        <div className={styles.fact}>
          <Icon name="users" size={18} />
          <div>
            {summary.roomsPaused
              ? <><strong>{t('gameHub.factTogetherSoon')}</strong><span>{t('gameHub.factTogetherSoonHint')}</span></>
              : <><strong>{free ? t('gameHub.factFreeHours', { left: number(free.left) }) : t('gameHub.factTogether')}</strong>
                <span>{summary.roomsCredits ? t('gameHub.factTogetherSpent', { credits: number(summary.roomsCredits) }) : t('gameHub.factTogetherHint')}</span></>}
          </div>
        </div>
      </section>

      {notices.map(notice => <div key={notice.key} className={styles.notice} role="status">
        <Icon name="alert-triangle" size={16} /><p>{notice.text}</p>
        {notice.action ? <Button size="sm" onClick={notice.action.run}>{notice.action.label}</Button> : null}
      </div>)}

      {list.games.length ? <div className={styles.toolbar}>
        <SegmentedTabs label={t('gameHub.filterLabel')} value={filter} onValueChange={value => setFilter(value as GameHubFilter)} items={[
          { value: 'all', label: t('gameHub.filterAll'), count: list.games.length },
          { value: 'multiplayer', label: t('gameHub.filterMultiplayer'), count: multiplayerCount },
          ...(orphanCount ? [{ value: 'orphans', label: t('gameHub.filterOrphans'), count: orphanCount }] : []),
        ]} />
        <Button variant="ghost" size="sm" onClick={refresh}><Icon name="refresh" size={14} />{t('gameHub.refresh')}</Button>
      </div> : null}

      {list.games.length === 0
        ? <div className={styles.empty}><Icon name="share" size={22} /><p>{t('gameHub.empty')}</p></div>
        : shown.length === 0
          ? <div className={styles.empty}><p>{filter === 'multiplayer' ? t('gameHub.emptyMultiplayer') : t('gameHub.emptyFilter')}</p></div>
          : <ul className={styles.games}>
            {shown.map(entry => <GameCard key={entry.game.shareId} entry={entry} roomsPaused={summary.roomsPaused}
              onOpenProject={onOpenProject} onChanged={refresh} />)}
          </ul>}
    </>;
  }

  return <section className={styles.view} data-testid="game-hub-view">
    <header className={styles.header}>
      <Eyebrow>{t('gameHub.eyebrow')}</Eyebrow>
      <h1>{t('gameHub.title')}</h1>
      <p className={styles.lede}>{t('gameHub.lede')}</p>
    </header>
    {body}
  </section>;
}

const STATUS_KEYS: Record<PublishedGameEntry['game']['state'], keyof Dict> = {
  live: 'gameHub.statusLive', under_review: 'gameHub.statusReview', removed: 'gameHub.statusRemoved',
};

function GameCard({ entry, roomsPaused, onOpenProject, onChanged }: {
  entry: PublishedGameEntry;
  roomsPaused: boolean;
  onOpenProject: (projectId: string) => void;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const settingsId = useId();
  const { game, rooms, online, project } = entry;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitText, setLimitText] = useState(String(rooms.monthlyCreditLimit));
  const [limitNote, setLimitNote] = useState<string | null>(null);
  useEffect(() => { setLimitText(String(rooms.monthlyCreditLimit)); }, [rooms.monthlyCreditLimit]);

  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(new Date(iso));
  const failure = (caught: unknown) => caught instanceof PublishRequestError && caught.code !== null ? caught.message : t('gameShare.actionFailed');
  const removed = game.state === 'removed';
  const hours = playerHours(rooms.playerMinutes);

  async function copy() {
    setCopied(await copyToClipboard(game.url) ? 'yes' : 'failed');
    window.setTimeout(() => setCopied(null), 2000);
  }
  async function remove() {
    setBusy(true); setError(null);
    try { await removeShare(game.shareId); setConfirmRemove(false); onChanged(); }
    catch (caught) { setError(failure(caught)); setConfirmRemove(false); }
    finally { setBusy(false); }
  }
  async function saveLimit() {
    const limit = parseLimit(limitText);
    if (limit === null) { setLimitNote(t('gameShare.limitInvalid')); return; }
    setBusy(true); setLimitNote(null);
    try { await updateShareRoomsLimit(game.shareId, limit); setLimitNote(t('gameShare.limitSaved')); onChanged(); }
    catch (caught) { setLimitNote(failure(caught)); }
    finally { setBusy(false); }
  }

  return <li className={styles.game} data-state={game.state} data-testid="game-hub-row">
    <div className={styles.tile} data-tone={tileTone(game.shareId)} aria-hidden="true">{tileLetter(game.title)}</div>

    <div className={styles.gameBody}>
      <div className={styles.gameTitle}>
        <h2>{game.title}</h2>
        <span className={styles.status} data-state={game.state}><span className={styles.dot} />{t(STATUS_KEYS[game.state])}</span>
      </div>
      <p className={styles.line}>
        {removed ? (game.removedReason ? t('gameShare.reason', { reason: game.removedReason }) : t('gameShare.removedBody'))
          : t('gameHub.playedLine', { count: number(game.playsThisMonth), date: day(game.updatedAt) })}
      </p>

      {online && (online.players > 0 || hours > 0) || (!roomsPaused && rooms.openRooms > 0) ? <ul className={styles.highlights}>
        {online && online.players > 0 ? <li><Icon name="star" size={14} />{t('gameHub.highlightPlayers', { count: number(online.players) })}</li> : null}
        {hours > 0 ? <li><Icon name="users" size={14} />{t('gameHub.highlightTogether', { hours: number(hours) })}</li> : null}
        {!roomsPaused && rooms.openRooms > 0 ? <li className={styles.liveNow}><span className={styles.dot} />{t('gameHub.highlightNow', { count: number(rooms.openRooms) })}</li> : null}
      </ul> : null}

      {game.state === 'under_review' ? <p className={styles.soft}>{t('gameShare.reviewBody')}</p> : null}
      {!project ? <p className={styles.soft}>{t('gameHub.noProjectHint')}</p> : null}
      {online?.idleDeleteAt ? <p className={styles.warn}>{t('gameHub.idle', { date: day(online.idleDeleteAt) })}</p> : null}

      <div className={styles.actions}>
        {!removed ? <>
          <Button size="sm" variant="primary" onClick={() => void copy()}>
            <Icon name={copied === 'yes' ? 'check' : 'link'} size={14} />{copied === 'yes' ? t('gameHub.copied') : t('gameHub.copyLink')}
          </Button>
          <Button size="sm" onClick={() => void openExternalUrl(game.url)}><Icon name="play" size={14} />{t('gameHub.play')}</Button>
        </> : null}
        {project ? <Button size="sm" variant="ghost" onClick={() => onOpenProject(project.id)}><Icon name="arrow-right" size={14} />{t('gameHub.openProject')}</Button> : null}
        <Button size="sm" variant="ghost" className={styles.more} aria-expanded={open} aria-controls={settingsId} onClick={() => setOpen(value => !value)}>
          <Icon name="settings" size={14} />{t('gameHub.settings')}
        </Button>
        <VisuallyHidden role="status">{copied === 'yes' ? t('gameShare.copiedAnnounce') : ''}</VisuallyHidden>
      </div>
      {copied === 'failed' ? <p className={styles.soft}>{t('gameShare.copyFailed')} <span className={styles.url}>{game.url}</span></p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {/* Kept mounted so collapsing animates too; `inert` keeps the closed settings out of tab order. */}
      <div id={settingsId} className={`accordion-collapsible${open ? ' open' : ''}`} aria-hidden={!open}
        ref={node => { if (node) { if (open) node.removeAttribute('inert'); else node.setAttribute('inert', ''); } }}>
        <div className="accordion-collapsible-inner">
          <div className={styles.settings}>
            {!removed ? <form className={styles.limit} onSubmit={event => { event.preventDefault(); void saveLimit(); }}>
              <label>
                <span className={styles.settingTitle}>{t('gameHub.limitTitle')}</span>
                <span className={styles.limitRow}>
                  <Input inputMode="numeric" aria-label={t('gameHub.limitTitle')} value={limitText}
                    onChange={event => { setLimitText(event.target.value); setLimitNote(null); }} />
                  <span>{t('gameHub.limitUnit')}</span>
                  <Button size="sm" type="submit" disabled={busy || limitText.trim() === String(rooms.monthlyCreditLimit)}>{t('gameHub.saveLimit')}</Button>
                </span>
              </label>
              <p className={styles.soft} role={limitNote ? 'status' : undefined}>{limitNote
                ?? (rooms.creditsCharged ? t('gameHub.limitSpent', { credits: number(rooms.creditsCharged) }) : t('gameHub.limitHint'))}</p>
            </form> : null}
            {!removed ? <div className={styles.address}>
              <span className={styles.settingTitle}>{t('gameHub.address')}</span>
              <span className={styles.url}>{game.url}</span>
            </div> : null}
            {!removed ? <div className={styles.removeRow}>
              <div><span className={styles.settingTitle}>{t('gameHub.stopSharing')}</span><p className={styles.soft}>{t('gameHub.stopSharingHint')}</p></div>
              <Button size="sm" variant="ghost" className={styles.danger} disabled={busy} onClick={() => setConfirmRemove(true)}>
                <Icon name="trash" size={14} />{t('gameShare.remove')}
              </Button>
            </div> : null}
          </div>
        </div>
      </div>
    </div>

    <ConfirmDialog open={confirmRemove} title={t('gameShare.removeTitle')} confirmLabel={t('gameShare.remove')} cancelLabel={t('common.cancel')}
      destructive busy={busy} onConfirm={() => void remove()} onCancel={() => setConfirmRemove(false)}>
      <p>{t('gameShare.removeBody')}</p>
      {!project ? <p>{t('gameHub.removeOrphan')}</p> : null}
    </ConfirmDialog>
  </li>;
}
