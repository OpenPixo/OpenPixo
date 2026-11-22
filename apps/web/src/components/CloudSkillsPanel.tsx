import { useCallback, useEffect, useState } from 'react';
import { Button } from '@openpixo/components';
import type { CloudSkillsResponse } from '@openpixo/contracts';
import { useI18n, useT } from '../i18n';
import styles from './CloudSkillsPanel.module.css';

async function readCloudSkills(path: string, method: 'GET' | 'POST'): Promise<CloudSkillsResponse> {
  const response = await fetch(path, { method, headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => null) as (CloudSkillsResponse & { error?: { message?: string } }) | null;
  if (!response.ok || !data || !Array.isArray(data.skills)) throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  return data;
}

/**
 * Skills and tools OpenPixo serves from its cloud. Read-only: the daemon downloads them, and the
 * agent uses them only with OpenPixo's models. Mirrors `pixo cloud-skills list|sync`.
 */
export function CloudSkillsPanel() {
  const t = useT();
  const { locale } = useI18n();
  const [state, setState] = useState<CloudSkillsResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readCloudSkills('/api/cloud-skills', 'GET')
      .then((data) => { if (!cancelled) setState(data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try { setState(await readCloudSkills('/api/cloud-skills/sync', 'POST')); setFailed(false); }
    catch { setFailed(true); }
    finally { setSyncing(false); }
  }, []);

  if (!state && !failed) return null;
  const syncedAt = state?.syncedAt ? new Date(state.syncedAt) : null;
  const error = failed ? t('settings.cloudSkillsUnavailable') : state?.error ?? null;

  return (
    <section className={styles.root} data-testid="cloud-skills" aria-labelledby="cloud-skills-title">
      <header className={styles.head}>
        <div>
          <h3 id="cloud-skills-title" className={styles.title}>{t('settings.cloudSkillsTitle')}</h3>
          <p className={styles.hint}>{t('settings.cloudSkillsHint')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void sync()} disabled={syncing || !state?.signedIn}
          data-testid="cloud-skills-sync">
          {syncing ? t('settings.cloudSkillsSyncing') : t('settings.cloudSkillsSync')}
        </Button>
      </header>
      {state && !state.signedIn ? <p className={styles.muted}>{t('settings.cloudSkillsSignIn')}</p> : null}
      {state?.skills.length ? (
        <ul className={styles.list}>
          {state.skills.map((skill) => (
            <li key={skill.name} className={styles.item}>
              <span className={styles.name}>{skill.title}</span>
              <span className={styles.description}>{skill.description}</span>
              {skill.active ? null : <span className={styles.muted}>{t('settings.cloudSkillsShadowed')}</span>}
            </li>
          ))}
        </ul>
      ) : state?.signedIn ? <p className={styles.muted}>{t('settings.cloudSkillsEmpty')}</p> : null}
      {state?.tools.length ? (
        <>
          <h4 className={styles.subtitle}>{t('settings.cloudToolsTitle')}</h4>
          <ul className={styles.list}>
            {state.tools.map((tool) => (
              <li key={tool.id} className={styles.item}>
                <code className={styles.name}>{tool.id}</code>
                <span className={styles.description}>{tool.description}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className={styles.muted}>
        {syncedAt
          ? t('settings.cloudSkillsSyncedAt', { time: syncedAt.toLocaleString(locale) })
          : t('settings.cloudSkillsNeverSynced')}
      </p>
      {error ? <p className={styles.error} role="status">{error}</p> : null}
    </section>
  );
}
