import { useEffect, useState } from 'react';
import { Button } from '@openpixo/components';
import type { DoctorCheck, DoctorGroup, DoctorSettingsSection } from '@openpixo/contracts';
import { useI18n } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { copyToClipboard } from '../../lib/copy-to-clipboard';
import { fetchDoctor } from '../../providers/doctor';
import { openExternalUrl } from '../../providers/registry';
import { Icon } from '../Icon';
import styles from './DoctorSection.module.css';

const GROUPS: DoctorGroup[] = ['agents', 'engines', 'media-tools', 'providers'];
const GROUP_KEYS = {
  agents: 'doctor.groupAgents', engines: 'doctor.groupEngines',
  'media-tools': 'doctor.groupMediaTools', providers: 'doctor.groupProviders',
} satisfies Record<DoctorGroup, keyof Dict>;
const TITLE_KEYS = {
  agent: 'doctor.agent', godot: 'doctor.godot', node: 'doctor.node', npm: 'doctor.npm',
  ffmpeg: 'doctor.ffmpeg', 'image-provider': 'doctor.imageProvider', 'audio-provider': 'doctor.audioProvider',
} satisfies Record<DoctorCheck['title']['code'], keyof Dict>;
const DETAIL_KEYS = {
  available: 'doctor.available', 'not-found': 'doctor.notFound', 'signed-in': 'doctor.signedIn',
  'sign-in-required': 'doctor.signInRequired', 'auth-unknown': 'doctor.authUnknown',
  configured: 'doctor.configured', 'not-configured': 'doctor.notConfigured',
  'probe-failed': 'doctor.probeFailed', 'probe-timeout': 'doctor.probeTimeout', 'invalid-path': 'doctor.invalidPath',
} satisfies Record<DoctorCheck['detail']['code'], keyof Dict>;
const STATUS_KEYS = {
  ok: 'doctor.statusOk', warn: 'doctor.statusWarn', missing: 'doctor.statusMissing', error: 'doctor.statusError',
} satisfies Record<DoctorCheck['status'], keyof Dict>;
const SOURCE_KEYS = {
  configured: 'doctor.sourceConfigured', path: 'doctor.sourcePath', bundled: 'doctor.sourceBundled',
} satisfies Record<NonNullable<DoctorCheck['detail']['params']>['source'] & string, keyof Dict>;

interface Props {
  onOpenSettings: (section: DoctorSettingsSection) => void;
}

export function DoctorSection({ onOpenSettings }: Props) {
  const { t } = useI18n();
  const [checks, setChecks] = useState<DoctorCheck[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    setCopyFailed(false);
    setCopiedId(null);
    void fetchDoctor(controller.signal).then(
      result => { if (!controller.signal.aborted) setChecks(result.checks); },
      () => { if (!controller.signal.aborted) setFailed(true); },
    ).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  function checkTitle(check: DoctorCheck): string {
    return check.title.code === 'agent' && check.title.params?.name
      ? check.title.params.name : t(TITLE_KEYS[check.title.code]);
  }

  function checkDetail(check: DoctorCheck): string {
    const params = check.detail.params;
    return [t(DETAIL_KEYS[check.detail.code]), params?.version,
      params?.source ? t(SOURCE_KEYS[params.source]) : undefined].filter(Boolean).join(' · ');
  }

  async function fixCheck(check: DoctorCheck): Promise<void> {
    const { fix } = check;
    if (fix.kind === 'install-url') {
      void openExternalUrl(fix.value);
    } else if (fix.kind === 'settings') {
      onOpenSettings(fix.value);
    } else {
      const copied = await copyToClipboard(fix.value);
      setCopiedId(copied ? check.id : null);
      setCopyFailed(!copied);
    }
  }

  function actionLabel(check: DoctorCheck): string {
    if (check.fix.kind === 'install-url') return t('doctor.download');
    if (check.fix.kind === 'settings') return t('doctor.openSettings');
    return t(copiedId === check.id ? 'doctor.copied' : 'doctor.copyCommand');
  }

  return (
    <section className={styles.section} aria-label={t('doctor.title')} aria-busy={loading}>
      <div className={styles.toolbar}>
        <Button variant="secondary" size="sm" disabled={loading} onClick={() => setRefresh(value => value + 1)}>
          <Icon name="refresh" size={14} />
          {t(loading ? 'doctor.checking' : 'doctor.recheck')}
        </Button>
      </div>
      {failed ? <p className={styles.error} role="alert">{t('doctor.loadError')}</p> : null}
      {copyFailed ? <p className={styles.error} role="alert">{t('doctor.copyFailed')}</p> : null}
      {loading && !checks ? <p className={styles.hint} role="status">{t('doctor.checking')}</p> : null}
      {checks?.length === 0 ? <p className={styles.hint}>{t('doctor.empty')}</p> : null}
      {GROUPS.map(group => {
        const rows = checks?.filter(check => check.group === group) ?? [];
        if (!rows.length) return null;
        return (
          <div className={styles.group} key={group}>
            <h3>{t(GROUP_KEYS[group])}</h3>
            <ul className={styles.list}>
              {rows.map(check => (
                <li className={styles.row} key={check.id}>
                  <div className={styles.rowBody}>
                    <div className={styles.rowHeading}>
                      <strong>{checkTitle(check)}</strong>
                      <span className={styles.status} data-status={check.status}>
                        <Icon name={check.status === 'ok' ? 'check' : check.status === 'warn' ? 'alert-triangle' : 'close'} size={13} />
                        {t(STATUS_KEYS[check.status])}
                      </span>
                    </div>
                    <p className={styles.hint}>{checkDetail(check)}</p>
                    {check.title.code === 'ffmpeg' && check.status !== 'ok' ? (
                      <p className={styles.hint}>{t('doctor.ffmpegHint')}</p>
                    ) : null}
                    {check.status !== 'ok' && check.fix.kind === 'command' ? (
                      <code className={styles.command}>{check.fix.value}</code>
                    ) : null}
                  </div>
                  {check.status !== 'ok' ? (
                    <Button variant="secondary" size="sm" className={styles.fix}
                      aria-label={t('doctor.actionFor', { action: actionLabel(check), name: checkTitle(check) })}
                      onClick={() => { void fixCheck(check); }}>
                      <Icon name={check.fix.kind === 'install-url' ? 'external-link' : check.fix.kind === 'settings' ? 'settings' : 'copy'} size={13} />
                      <span aria-live="polite">{actionLabel(check)}</span>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
