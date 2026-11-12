import { useEffect, useState } from 'react';
import { Button } from '@openpixo/components';
import { GAME_SETUP_STEPS, type GameProjectSetupResponse } from '@openpixo/contracts';
import { ListChecks } from 'lucide-react';
import { useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { fetchGameSetup } from '../new-game/game-setup-api';
import { GameSetupDialog } from './GameSetupDialog';
import styles from './GameSetupCard.module.css';

const laterKey = (projectId: string) => `pixo:game-setup-later:${projectId}`;

function hiddenForSession(projectId: string): boolean {
  try { return window.sessionStorage.getItem(laterKey(projectId)) === '1'; } catch { return false; }
}

/**
 * "Finish setup" for a game that skipped the new-game wizard (folder import,
 * `pixo project create-game` without setup flags). It names the missing
 * steps and opens the same steps in a dialog; once every step has its
 * answers it disappears. "Later" hides it for this session only.
 */
export function GameSetupCard({ projectId }: { projectId: string }) {
  const t = useT();
  const [state, setState] = useState<{ projectId: string; data: GameProjectSetupResponse | null }>({ projectId, data: null });
  const [hidden, setHidden] = useState(() => hiddenForSession(projectId));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setHidden(hiddenForSession(projectId));
    void fetchGameSetup(projectId, controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ projectId, data }); })
      // An older daemon without the endpoint simply shows no card.
      .catch(() => { if (!controller.signal.aborted) setState({ projectId, data: null }); });
    return () => controller.abort();
  }, [projectId]);

  const data = state.projectId === projectId ? state.data : null;
  const missing = data?.missingSteps ?? [];
  const visible = Boolean(data) && missing.length > 0 && !hidden;

  function later() {
    try { window.sessionStorage.setItem(laterKey(projectId), '1'); } catch { /* hidden until remount */ }
    setHidden(true);
  }

  return (
    <>
      <div className={`accordion-collapsible ${visible ? 'open' : ''} ${styles.visibility}`} data-open={visible} aria-hidden={!visible}>
        <div className="accordion-collapsible-inner">
          {visible ? (
            <section className={styles.card} aria-label={t('game.setup.card.title')} data-testid="game-setup-card">
              <span className={styles.icon} aria-hidden="true"><ListChecks size={16} /></span>
              <div className={styles.text}>
                <h3 className={styles.title}>{t('game.setup.card.title')}</h3>
                <p className={styles.body}>{t('game.setup.card.body')}</p>
                <ul className={styles.steps}>
                  {GAME_SETUP_STEPS.map(step => (
                    <li key={step} data-done={!missing.includes(step)}>{t(`game.wizard.step.${step}` as keyof Dict)}</li>
                  ))}
                </ul>
              </div>
              <div className={styles.actions}>
                <Button size="sm" variant="primary" onClick={() => setOpen(true)}>{t('game.setup.card.action')}</Button>
                <Button size="sm" variant="ghost" onClick={later}>{t('game.setup.card.later')}</Button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
      {open && data ? (
        <GameSetupDialog projectId={projectId} setup={data.setup} onClose={() => setOpen(false)}
          onSaved={result => setState({ projectId, data: result })} />
      ) : null}
    </>
  );
}
