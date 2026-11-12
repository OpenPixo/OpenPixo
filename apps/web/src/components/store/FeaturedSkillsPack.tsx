import { useState } from 'react';
import { AccentText, Button } from '@openpixo/components';
import type { StoreCatalogItem } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import styles from './WorkshopHero.module.css';

/**
 * The free Game-dev toolkit spotlight copy: installs every free skill that is
 * not installed yet, one at a time, and keeps going past a failure so a retry
 * only installs what is still missing.
 */
export function FeaturedSkillsPack({ skills, onInstall, installing, examplesOpen, onToggleExamples }: {
  skills: StoreCatalogItem[];
  onInstall: (item: StoreCatalogItem) => Promise<void>;
  installing: boolean;
  examplesOpen: boolean;
  onToggleExamples: () => void;
}) {
  const { t } = useI18n();
  const [progress, setProgress] = useState<{ current: number; total: number }>();
  const [failures, setFailures] = useState<string[]>([]);
  const examples = skills.flatMap(item => item.examples ?? []);
  const engines = new Set(skills.flatMap(item => item.engines).filter(engine => engine !== 'any'));
  const pending = skills.filter(item => !item.installedVersion && item.pricing.type === 'free');
  const allInstalled = skills.every(item => item.installedVersion);

  const installAll = async () => {
    const failed: string[] = [];
    setFailures([]);
    setProgress({ current: 0, total: pending.length });
    for (const [index, item] of pending.entries()) {
      try { await onInstall(item); }
      catch (cause) { failed.push(`${item.title ?? item.name}: ${cause instanceof Error ? cause.message : String(cause)}`); }
      setProgress({ current: index + 1, total: pending.length });
    }
    setFailures(failed);
    setProgress(undefined);
  };

  return <>
    <h2 className={styles.title}>{t('workshop.packLead')}<AccentText>{t('workshop.packAccent')}</AccentText></h2>
    <p className={styles.description}>{t('workshop.packDescription')}</p>
    <dl className={styles.stats}>
      <div><dt>{t('workshop.statsSkills')}</dt><dd>{skills.length}</dd></div>
      <div><dt>{t('workshop.statsExamples')}</dt><dd>{examples.length}</dd></div>
      <div><dt>{t('workshop.statsEngines')}</dt><dd>{engines.size}</dd></div>
    </dl>
    <div className={styles.actions}>
      <span className={styles.badge} data-state="free">{t('store.free')}</span>
      <Button variant="primary" size="lg" disabled={installing || Boolean(progress) || !pending.length} onClick={() => void installAll()}>
        {progress ? t('workshop.installProgress', { current: String(progress.current), total: String(progress.total) })
          : t(allInstalled ? 'workshop.allInstalled' : 'workshop.installAll')}
      </Button>
      <Button variant="secondary" size="lg" className={styles.secondary} disabled={!examples.length} aria-expanded={examplesOpen}
        aria-controls="workshop-toolkit-examples" onClick={onToggleExamples}>{t('workshop.seeExamples')}</Button>
    </div>
    {progress ? <p className={styles.status} role="status" aria-live="polite">{t('workshop.installProgress', { current: String(progress.current), total: String(progress.total) })}</p> : null}
    {failures.length ? <p className={styles.error} role="alert">{t('workshop.installFailed')} {failures.join(', ')}</p> : null}
  </>;
}
