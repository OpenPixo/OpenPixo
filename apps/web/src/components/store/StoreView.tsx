import { useEffect, useState } from 'react';
import { AccentText, Button, Eyebrow, Input, SegmentedTabs, Select, VisuallyHidden } from '@openpixo/components';
import type { StoreCatalogItem, StoreItemKind, StorePurchaseResponse } from '@openpixo/contracts';
import { Search, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { buildPath, navigate } from '../../router';
import { usePageNavigationReady } from '../../observability/navigation-timing';
import { fetchStoreCatalog, installStoreItem, isGenerateKind, isWorkshopItem, mostRecentStoreProject, openProjectGenerate, WORKSHOP_KINDS, type WorkshopKind } from '../../state/store';
import { BuyDialog } from './BuyDialog';
import { CreditsChip } from './CreditsChip';
import { GenerateRedirect } from './GenerateRedirect';
import { StoreCard } from './StoreCard';
import { StoreExamples } from './StoreExamples';
import { StoreItemPage } from './StoreItemPage';
import { StoreShelf } from './StoreShelf';
import { WorkshopHero } from './WorkshopHero';
import { hasTag, heroSlides, humanizeTag, itemTitle, quickTags, searchText, WORKSHOP_TAB_ORDER, type WorkshopItem } from './workshop-catalog';
import styles from './StoreView.module.css';

export interface StoreProject { id: string; name: string; updatedAt?: number | string; createdAt?: number | string }
export type StoreTab = 'featured' | StoreItemKind;
export interface StoreActions {
  onTryExample?: (prompt: string, styleId?: string) => void;
  onUseStyle?: (styleId: string) => void;
}
export interface StoreViewProps extends StoreActions {
  itemName?: string;
  projects?: StoreProject[];
  initialTab?: StoreTab;
  /** Opens Settings › Account & credits. Without it, "Get credits" opens Settings. */
  onOpenAccount?: () => void;
}

type WorkshopTab = 'discover' | WorkshopKind;

/** Shelf copy per category, in Discover order. */
const SHELVES: Array<{ kind: WorkshopKind; size: 'default' | 'feature' }> = [
  { kind: 'asset-pack', size: 'feature' },
  { kind: 'skill', size: 'default' },
  { kind: 'project-template', size: 'default' },
  { kind: 'mcp', size: 'default' },
];

export function StoreView({ itemName, projects = [], initialTab, onOpenAccount, ...actions }: StoreViewProps) {
  const openAccount = onOpenAccount ?? (() => navigate({ kind: 'home', view: 'settings' }));
  if (itemName) return <StoreItemPage key={itemName} name={itemName} projects={projects} onOpenAccount={openAccount} {...actions} />;
  if (initialTab && isGenerateKind(initialTab)) return <GenerateRedirect projects={projects} />;
  return <StoreCatalog initialTab={initialTab} projects={projects} onOpenAccount={openAccount} {...actions} />;
}

function initialWorkshopTab(tab?: StoreTab): WorkshopTab {
  return WORKSHOP_KINDS.find(kind => kind === tab) ?? 'discover';
}

function StoreCatalog({ initialTab, projects, onOpenAccount, ...actions }: StoreActions & {
  initialTab?: StoreTab; projects: StoreProject[]; onOpenAccount: () => void;
}) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<StoreCatalogItem[]>([]);
  const [tab, setTab] = useState<WorkshopTab>(() => initialWorkshopTab(initialTab));
  const [engine, setEngine] = useState('');
  const [pricing, setPricing] = useState<'' | 'free' | 'paid'>('');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [installError, setInstallError] = useState('');
  const [installingName, setInstallingName] = useState<string>();
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [buyName, setBuyName] = useState<string>();
  const [buyOpen, setBuyOpen] = useState(false);
  useEffect(() => { setTab(initialWorkshopTab(initialTab)); }, [initialTab]);
  usePageNavigationReady({ page: 'store', visible: !loading, ready: !loading && !error, failure: Boolean(error) });
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    void fetchStoreCatalog({}, locale)
      .then(result => { if (!cancelled) setItems(result.items); })
      .catch(cause => { console.warn('[Store] catalog load failed:', cause); if (!cancelled) setError(t('store.loadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retry, locale]);

  const workshopItems = items.filter(isWorkshopItem) as WorkshopItem[];
  const search = q.trim().toLocaleLowerCase(locale);
  const filtered = workshopItems.filter(item =>
    (!engine || item.engines.includes('any') || item.engines.includes(engine))
    && (!pricing || item.pricing.type === pricing)
    && (!tag || hasTag(item, tag))
    && (!search || searchText(item, t(`workshop.kind.${item.kind}`), locale).includes(search)));
  const filtersActive = Boolean(search || tag || engine || pricing);
  const visibleItems = tab === 'discover' ? filtered : filtered.filter(item => item.kind === tab);
  const recentProject = mostRecentStoreProject(projects);
  const engines = [...new Set(workshopItems.flatMap(item => item.engines).filter(value => value !== 'any'))].sort();
  const tags = quickTags(tab === 'discover' ? workshopItems : workshopItems.filter(item => item.kind === tab));
  const slides = heroSlides(workshopItems);
  const buyItem = buyName ? items.find(item => item.name === buyName) ?? null : null;

  const install = async (item: StoreCatalogItem) => {
    // An owned asset pack is added to one game, which its own page asks for.
    if (item.kind === 'asset-pack' && item.pricing.type === 'paid') { navigate({ kind: 'home', view: 'store', storeItemName: item.name }); return; }
    setInstallingName(item.name);
    try {
      const result = await installStoreItem({ name: item.name, version: item.version });
      setItems(current => current.map(entry => entry.name === item.name ? { ...entry, installedVersion: result.version } : entry));
      if (result.warnings?.length) setNotice(result.warnings.join(' '));
    } finally { setInstallingName(undefined); }
  };
  const installFromCard = (item: StoreCatalogItem) => {
    setInstallError(''); setNotice('');
    void install(item).then(() => setNotice(current => current || t('workshop.installedNotice', { name: itemTitle(item, locale) })))
      .catch(cause => { console.warn('[Store] install failed:', cause); setInstallError(t('store.installFailed')); });
  };
  const openBuy = (item: StoreCatalogItem) => { setBuyName(item.name); setBuyOpen(true); };
  const purchased = (item: StoreCatalogItem, _result: StorePurchaseResponse) => {
    setItems(current => current.map(entry => entry.name === item.name ? { ...entry, owned: true } : entry));
  };
  const clearFilters = () => { setQ(''); setTag(''); setEngine(''); setPricing(''); };
  const card = (item: StoreCatalogItem, size: 'default' | 'feature' = item.kind === 'asset-pack' ? 'feature' : 'default') =>
    <StoreCard key={item.name} item={item} size={size} installing={installingName === item.name} disabled={Boolean(installingName)}
      onInstall={installFromCard} onBuy={openBuy} />;

  const tabItems = [
    { value: 'discover', label: t('workshop.tab.discover'), id: 'workshop-tab-discover', panelId: 'workshop-items' },
    ...WORKSHOP_TAB_ORDER.map(kind => ({ value: kind, label: t(`workshop.kind.${kind}`), count: filtered.filter(item => item.kind === kind).length,
      id: `workshop-tab-${kind}`, panelId: 'workshop-items' })),
  ];

  return <section className={styles.view} data-testid="store-view">
    <header className={styles.header}>
      <div className={styles.top}>
        <div className={styles.intro}>
          <Eyebrow>{t('workshop.eyebrow', { count: String(workshopItems.length) })}</Eyebrow>
          <h1>{t('workshop.titleLead')}<AccentText>{t('workshop.titleAccent')}</AccentText>{t('workshop.titleEnd')}</h1>
          <p className={styles.lede}>{t('workshop.lede')}</p>
        </div>
        <div className={styles.tools}>
          <CreditsChip onGetCredits={onOpenAccount} />
          <div className={styles.search}><Search size={16} aria-hidden="true" /><Input type="search" aria-label={t('workshop.search')}
            placeholder={t('workshop.searchPlaceholder')} value={q} onChange={event => setQ(event.target.value)} /></div>
        </div>
      </div>
      <SegmentedTabs className={styles.categories} label={t('store.categories')} value={tab} onValueChange={value => setTab(value as WorkshopTab)} items={tabItems} />
    </header>
    {loading ? <LoadingShelves label={t('common.loading')} /> : error ? (
      <div className={styles.failure} role="alert"><p>{error}</p><Button onClick={() => setRetry(value => value + 1)}>{t('store.retry')}</Button></div>
    ) : <section id="workshop-items" role="tabpanel" aria-labelledby={`workshop-tab-${tab}`} className={styles.panel}>
      <div className={styles.toolbar}>
        {tags.length ? <div className={styles.chips} role="group" aria-label={t('workshop.tags')}>
          {tags.map(value => <button key={value} type="button" className={styles.chip} aria-pressed={tag === value}
            onClick={() => setTag(current => current === value ? '' : value)}>#{humanizeTag(value)}</button>)}
        </div> : <span />}
        <div className={styles.filters}>
          <Select aria-label={t('store.engine')} value={engine} onChange={event => setEngine(event.target.value)}>
            <option value="">{t('store.allEngines')}</option>{engines.map(value => <option key={value} value={value}>{value}</option>)}
          </Select>
          <Select aria-label={t('store.pricing')} value={pricing} onChange={event => setPricing(event.target.value as typeof pricing)}>
            <option value="">{t('workshop.anyPrice')}</option><option value="free">{t('store.free')}</option><option value="paid">{t('store.paid')}</option>
          </Select>
          {filtersActive ? <Button variant="ghost" size="sm" className={styles.clear} onClick={clearFilters}><X size={14} aria-hidden="true" />{t('workshop.clearFilters')}</Button> : null}
        </div>
      </div>
      {installError ? <p className={styles.installError} role="alert">{installError}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {tab === 'discover' && !filtersActive ? <>
        <WorkshopHero slides={slides} installingName={installingName} onInstall={install} onBuy={openBuy}
          examplesOpen={examplesOpen} onToggleExamples={() => setExamplesOpen(value => !value)} />
        {examplesOpen ? <div id="workshop-toolkit-examples">
          <StoreExamples examples={workshopItems.filter(item => item.kind === 'skill').flatMap(item => item.examples ?? [])} onTryExample={actions.onTryExample} />
        </div> : null}
        {SHELVES.map(({ kind, size }) => {
          const shelfItems = workshopItems.filter(item => item.kind === kind);
          if (!shelfItems.length) return null;
          return <StoreShelf key={kind} title={t(`workshop.shelf.${kind}.title`)} subtitle={t(`workshop.shelf.${kind}.subtitle`)}
            count={shelfItems.length} size={size} onSeeAll={() => setTab(kind)}>{shelfItems.map(item => card(item, size))}</StoreShelf>;
        })}
        <aside className={styles.moved}>
          <span className={styles.pixel} aria-hidden="true" />
          <div><strong>{t('workshop.movedTitle')}</strong><span>{t('workshop.moved')}</span></div>
          {recentProject ? <a href={buildPath({ kind: 'project', projectId: recentProject.id, fileName: null, workspaceTab: 'generate' })} onClick={event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); openProjectGenerate(recentProject);
          }}>{t('workshop.openGenerate', { name: recentProject.name })}</a>
            : <span className={styles.movedHint}>{t('workshop.projectRequired')}</span>}
        </aside>
      </> : <>
        <div className={styles.gridHead}>
          <h2>{tab === 'discover' ? t('workshop.results') : t(`workshop.kind.${tab}`)}</h2>
          <span className={styles.gridCount}>{visibleItems.length}</span>
          {tab !== 'discover' ? <p>{t(`workshop.shelf.${tab}.subtitle`)}</p> : null}
        </div>
        {visibleItems.length ? <ul className={styles.items} data-size={tab === 'asset-pack' ? 'feature' : 'default'}>
          {visibleItems.map(item => card(item, tab === 'asset-pack' ? 'feature' : 'default'))}
        </ul> : <div className={styles.empty} role="status">
          <p>{t('store.empty')}</p>
          {filtersActive ? <Button variant="secondary" size="sm" onClick={clearFilters}>{t('workshop.clearFilters')}</Button> : null}
        </div>}
      </>}
    </section>}
    <BuyDialog item={buyItem} open={buyOpen} onClose={() => setBuyOpen(false)} onPurchased={purchased}
      onInstall={installFromCard} onGetCredits={onOpenAccount} />
  </section>;
}

function LoadingShelves({ label }: { label: string }) {
  return <div className={styles.loading} role="status" aria-busy="true">
    <VisuallyHidden>{label}</VisuallyHidden>
    <div className={styles.skeletonHero} aria-hidden="true" />
    <div className={styles.skeletonRow} aria-hidden="true">{[0, 1, 2].map(index => <div key={index} />)}</div>
  </div>;
}
