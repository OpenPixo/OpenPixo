// "Have you made a game before?" is an app preference (`AppConfigPrefs.gameExperience`),
// asked once by the new-game dialog and changeable in Settings. The dialog
// reads and writes it through the same `/api/app-config` the Settings page and
// `pixo config get|set gameExperience` use.
import { isGameExperience, type AppConfigResponse, type GameExperience, type UpdateAppConfigRequest } from '@openpixo/contracts';
import { APP_CONFIG_CHANGED_EVENT } from '../../state/config';

/** The saved answer, or null when it was never given (or the daemon could not say). */
export async function fetchGameExperience(signal?: AbortSignal): Promise<GameExperience | null> {
  try {
    const response = await fetch('/api/app-config', { signal: signal ?? AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const body = await response.json() as Partial<AppConfigResponse>;
    return isGameExperience(body.config?.gameExperience) ? body.config!.gameExperience : null;
  } catch {
    return null;
  }
}

/** Remember the answer for the next game; the app reloads its copy of the config so Settings shows it. */
export async function saveGameExperience(experience: GameExperience): Promise<void> {
  const body: UpdateAppConfigRequest = { gameExperience: experience };
  try {
    const response = await fetch('/api/app-config', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (response.ok) window.dispatchEvent(new Event(APP_CONFIG_CHANGED_EVENT));
  } catch { /* Not saved: the next new game asks again. */ }
}
