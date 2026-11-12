import { useEffect, useId, useState } from 'react';
import { Button } from '@openpixo/components';
import { CAPABILITY_CELLS, type AgentCapabilitiesResponse } from '@openpixo/contracts';
import { useI18n } from '../i18n';
import { fetchAgentCapabilities } from '../providers/agent-capabilities';
import styles from './AgentCapabilityMatrix.module.css';

const RUNTIME_NAMES: Record<string, string> = { codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode' };

export function AgentCapabilityMatrix() {
  const { t } = useI18n();
  const titleId = useId();
  const [data, setData] = useState<AgentCapabilitiesResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setData(null);
    void (async () => {
      try {
        const result = await fetchAgentCapabilities(refresh > 0);
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  const runtimes = data ? Object.entries(data.matrix) : [];
  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <div className={styles.header}>
        <h4 id={titleId}>{t('agentCapabilities.title')}</h4>
        <Button variant="ghost" size="sm" onClick={() => setRefresh(value => value + 1)}>
          {t('agentCapabilities.refresh')}
        </Button>
      </div>
      <p className={styles.hint}>{t('agentCapabilities.hint')}</p>
      {failed ? <p role="alert" className={styles.hint}>{t('agentCapabilities.loadError')}</p> : !data ? (
        <p role="status" className={styles.hint}>{t('agentCapabilities.loading')}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table} aria-labelledby={titleId}>
            <thead>
              <tr>
                <th scope="col">{t('agentCapabilities.capability')}</th>
                {runtimes.map(([id]) => (
                  <th scope="col" key={id}>
                    {RUNTIME_NAMES[id] ?? id}
                    {data.runtimes[id]?.installedVersion ? <small>{data.runtimes[id]?.installedVersion}</small> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_CELLS.map(key => (
                <tr key={key}>
                  <th scope="row">{t(`agentCapabilities.cell.${key}`)}</th>
                  {runtimes.map(([id, cells]) => {
                    const cell = cells[key];
                    const tooltip = [
                      cell.note,
                      cell.testedVersion ? `${t('agentCapabilities.testedVersion')}: ${cell.testedVersion}` : null,
                    ].filter(Boolean).join('\n');
                    return (
                      <td key={id} title={tooltip || undefined}>
                        <span className={styles.badge} data-state={cell.state}>
                          {t(`agentCapabilities.state.${cell.state}`)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
