import { useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { gameRunErrorKey } from './GameRun.errors';

/** Known daemon reasons are translated; unknown diagnostics stay in a disclosure. */
export function GameFailure({ failure, context, fallback, alert = false }: {
  failure: { code?: string | undefined; detail?: string | undefined };
  context: 'verify' | 'playtest'; fallback: keyof Dict; alert?: boolean;
}) {
  const t = useT();
  const key = gameRunErrorKey(failure.code, context);
  const unknown = key === 'gameRun.unknownError';
  return <div>
    <p role={alert ? 'alert' : undefined}>{t(!failure.code ? fallback : key)}</p>
    {unknown && failure.detail ? <details><summary>{t('game.errorDetails')}</summary><pre>{failure.detail}</pre></details> : null}
  </div>;
}
