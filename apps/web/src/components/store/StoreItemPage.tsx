import { useEffect, useRef, useState } from 'react';
import { Button, Card, Eyebrow, Select, Tag } from '@openpixo/components';
import type { StoreItemDetail, StorePurchaseResponse } from '@openpixo/contracts';
import { ArrowLeft, BadgeCheck, CircleSlash, FileText, Quote } from 'lucide-react';
import { useI18n } from '../../i18n';
import { navigate } from '../../router';
import { usePageNavigationReady } from '../../observability/navigation-timing';
import { isCloudAccountAvailable, useOpenPixoAccount, useOpenPixoCredits } from '../../hooks/useOpenPixoAccount';
import { fetchStoreItem, installStoreItem, isGenerateKind, type WorkshopKind } from '../../state/store';
import { formatCredits } from '../account/account-format';
import type { StoreProject } from './StoreView';
import { BuyDialog } from './BuyDialog';
import { GenerateRedirect } from './GenerateRedirect';
import { PreviewGallery } from './PreviewGallery';
import { StoreCover } from './StoreCover';
import { StoreExamples } from './StoreExamples';
import { StorePrice } from './StorePrice';
import { humanizeTag, itemDescription, itemTitle, needsPurchase } from './workshop-catalog';
import { openSkillsSettings } from '../../settings-navigation';
import { engineName } from '../game/engine-names';
import styles from './StoreItemPage.module.css';

const OPEN_LICENSES = ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'CC-BY-4.0'];
const HIDDEN_TAGS = new Set(['first-party', 'openpixo']);

export function StoreItemPage({ name, projects, onTryExample, onOpenAccount }: {
  name: string;
  projects: StoreProject[];
  onTryExample?: (prompt: string, styleId?: string) => void;
  onUseStyle?: (id: string) => void;
  onOpenAccount: () => void;
}) {
  const { t, locale } = useI18n();
  const [item, setItem] = useState<StoreItemDetail | null>(null);
  const [projectId, setProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const [buyOpen, setBuyOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const account = useOpenPixoAccount();
  const signedIn = isCloudAccountAvailable(account.status) && Boolean(account.status?.signedIn);
  const { credits } = useOpenPixoCredits(signedIn);
  usePageNavigationReady({ page: 'store', visible: !loading, ready: !loading && Boolean(item), failure: !loading && !item && Boolean(error) });
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setItem(null); setError(''); setMessage('');
    void fetchStoreItem(name, locale).then(result => { if (!cancelled) setItem(result); })
      .catch(cause => { console.warn('[Store] item load failed:', cause); if (!cancelled) setError(t('store.itemLoadFailed')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [name, retry, locale]);
  useEffect(() => { if (item) heading.current?.focus(); }, [item?.name]);

  async function install() {
    if (!item || needsPurchase(item) || installing) return;
    setInstalling(true); setError(''); setMessage('');
    try {
      const result = await installStoreItem({ name: item.name, version: item.version, ...(projectId ? { projectId } : {}) });
      setItem({ ...item, installedVersion: result.version });
      setMessage([t('store.installed'), ...result.warnings].join(' · '));
    } catch (cause) { console.warn('[Store] install failed:', cause); setError(t('store.installFailed')); }
    finally { setInstalling(false); }
  }

  if (item && isGenerateKind(item.kind)) return <GenerateRedirect projects={projects} />;

  // Missing commercial terms stay explicit instead of guessing from an unfamiliar license.
  const commercial = item?.assetLicense?.commercialUse ?? (item && OPEN_LICENSES.includes(item.license) ? true : undefined);
  const title = item ? itemTitle(item, locale) : '';
  const tags = (item?.tags ?? []).filter(tag => !HIDDEN_TAGS.has(tag));
  const engines = (item?.engines ?? []).filter(engine => engine !== 'any');
  const paid = item ? needsPurchase(item) : false;
  const back = <Button variant="ghost" className={styles.back} onClick={() => navigate({ kind: 'home', view: 'store' })}>
    <ArrowLeft size={16} aria-hidden="true" />{t('store.title')}
  </Button>;

  return (
    <section className={styles.view} data-testid="store-item-page">
      {item ? <div className={styles.backdrop} aria-hidden="true"><StoreCover item={item} className={styles.backdropCover} /></div> : null}
      <div className={styles.inner}>
        {back}
        {loading ? <div className={styles.loading} role="status" aria-busy="true">{t('common.loading')}</div> : item ? <>
          <header className={styles.hero}>
            <div className={styles.heroCopy}>
              <Eyebrow>{t('store.title')} · {t(`workshop.kind.${item.kind as WorkshopKind}`)}</Eyebrow>
              <h1 ref={heading} tabIndex={-1}>{title}</h1>
              <p className={styles.description}>{itemDescription(item, locale)}</p>
              <div className={styles.meta}>
                {engines.map(engine => <Tag key={engine}>{engineName(engine)}</Tag>)}
                <span>{item.name}</span><span>v{item.version}</span>
              </div>
            </div>
            <div className={styles.heroArt}><StoreCover item={item} eager /></div>
          </header>
          <div className={styles.layout}>
            <div className={styles.main}>
              {item.previews.length ? <PreviewGallery previews={item.previews} title={title} /> : null}
              {tags.length || item.requires.capabilities?.length ? <section className={styles.section} aria-labelledby="store-inside-title">
                <h2 id="store-inside-title">{t('workshop.detail.inside')}</h2>
                {tags.length ? <ul className={styles.chips}>{tags.map(tag => <li key={tag}>#{humanizeTag(tag)}</li>)}</ul> : null}
                {item.requires.capabilities?.length ? <p className={styles.requires}>{t('store.requires')}: {item.requires.capabilities.join(', ')}</p> : null}
              </section> : null}
              <StoreExamples examples={item.examples ?? []} onTryExample={onTryExample} />
              <section className={styles.section} aria-labelledby="store-license-title">
                <h2 id="store-license-title">{t('store.license')}</h2>
                <ul className={styles.license}>
                  <li data-tone={commercial === undefined ? 'neutral' : commercial ? 'good' : 'warn'}>
                    {commercial === false ? <CircleSlash size={18} aria-hidden="true" /> : <BadgeCheck size={18} aria-hidden="true" />}
                    <div><strong>{t('store.commercialUse')}</strong>
                      <span>{commercial === undefined ? t('store.checkLicense') : commercial ? t('workshop.detail.commercialYes') : t('workshop.detail.commercialNo')}</span></div>
                  </li>
                  <li data-tone="neutral">
                    <Quote size={18} aria-hidden="true" />
                    <div><strong>{t('store.attribution')}</strong>
                      <span>{item.assetLicense ? item.assetLicense.attributionRequired ? t('workshop.detail.attributionYes') : t('workshop.detail.attributionNo') : t('store.checkLicense')}</span></div>
                  </li>
                  <li data-tone="neutral">
                    <FileText size={18} aria-hidden="true" />
                    <div><strong>{t('store.license')}</strong><span>{item.license}</span></div>
                  </li>
                </ul>
              </section>
              <section className={styles.section} aria-labelledby="store-details-title">
                <h2 id="store-details-title">{t('store.details')}</h2>
                <dl className={styles.facts}>
                  <dt>{t('store.version')}</dt><dd>{item.version}</dd>
                  <dt>{t('store.versions')}</dt><dd>{item.versions.join(', ')}</dd>
                  <dt>{t('store.engine')}</dt><dd>{item.engines.map(engineName).join(', ')}</dd>
                  <dt>{t('store.requires')}</dt><dd>{item.requires.capabilities?.join(', ') || t('store.none')}</dd>
                  {item.requires.openpixo ? <><dt>OpenPixo</dt><dd>{item.requires.openpixo}</dd></> : null}
                </dl>
              </section>
            </div>
            <Card className={styles.actions}>
              {item.builtIn ? null : <Eyebrow>{t(paid ? 'workshop.detail.buyEyebrow' : 'store.readyForAgent')}</Eyebrow>}
              <StorePrice item={item} size="lg" />
              {item.builtIn ? <>
                <p className={styles.balance}>{t(item.builtIn.enabled ? 'store.builtInHint' : 'store.builtInOffHint')}</p>
                <Button variant="secondary" onClick={openSkillsSettings} data-testid="store-manage-skills">{t('store.manageSkills')}</Button>
              </> : null}
              {!paid && !item.installedVersion && !item.builtIn && projects.length ? <label className={styles.project}>{t('store.project')}
                <Select value={projectId} disabled={installing} onChange={event => { setProjectId(event.target.value); setMessage(''); }}>
                  <option value="">{t('store.thisDevice')}</option>
                  {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </Select>
              </label> : null}
              {paid ? <Button variant="primary" size="lg" onClick={() => setBuyOpen(true)}>{t('workshop.buy')}</Button>
                : item.installedVersion || item.builtIn ? null
                  : <Button variant="primary" size="lg" disabled={installing} onClick={() => { void install(); }}>{installing ? t('store.installing') : t('store.install')}</Button>}
              {paid && signedIn && credits ? <p className={styles.balance}>{t('workshop.credits.aria', { n: formatCredits(credits.available, locale) })}</p> : null}
              {paid && !signedIn ? <p className={styles.balance}>{t('workshop.detail.signInHint')}</p> : null}
              {item.installedVersion ? <span className={styles.installed}><i aria-hidden="true" />{t('store.installed')} · {item.installedVersion}</span> : null}
              {message ? <p className={styles.message} role="status">{message}</p> : null}
            </Card>
          </div>
          <BuyDialog item={item} open={buyOpen} onClose={() => setBuyOpen(false)}
            onPurchased={(_bought, _result: StorePurchaseResponse) => setItem(current => current ? { ...current, owned: true } : current)}
            onInstall={() => { void install(); }} onGetCredits={onOpenAccount} />
        </> : null}
        {error ? <div className={styles.error} role="alert"><p>{error}</p>{!item ? <Button onClick={() => setRetry(value => value + 1)}>{t('store.retry')}</Button> : null}</div> : null}
      </div>
    </section>
  );
}
