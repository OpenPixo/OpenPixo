// The image model the agent makes art with (`AppConfigPrefs.agentImageModel`), chosen
// apart from the chat agent. The Settings select and the composer chip read the
// daemon's list from `GET /api/media/agent-image-models` and write the pick through
// `PUT /api/app-config`, the same endpoints `pixo media image-models` and
// `pixo config set agentImageModel <id|auto>` use. The pick is saved at once and is not
// part of the Settings draft, so saving Settings never overwrites a chip change.
import { useCallback, useEffect, useState } from 'react';
import {
  AGENT_IMAGE_MODEL_AUTOMATIC,
  type AgentImageModelsResponse,
  type UpdateAppConfigRequest,
} from '@openpixo/contracts';

/** Fired after a pick is saved, so every open select and chip shows it. */
export const AGENT_IMAGE_MODEL_CHANGED_EVENT = 'pixo:agent-image-model-changed';

export async function fetchAgentImageModels(signal?: AbortSignal): Promise<AgentImageModelsResponse | null> {
  try {
    const response = await fetch('/api/media/agent-image-models', { signal: signal ?? AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    return await response.json() as AgentImageModelsResponse;
  } catch {
    return null;
  }
}

/** Saves the pick; null is automatic. Resolves false when the daemon refused or could not be reached. */
export async function saveAgentImageModel(id: string | null): Promise<boolean> {
  const body: UpdateAppConfigRequest = { agentImageModel: id ?? AGENT_IMAGE_MODEL_AUTOMATIC };
  try {
    const response = await fetch('/api/app-config', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) return false;
    window.dispatchEvent(new Event(AGENT_IMAGE_MODEL_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

export interface AgentImageModelsState {
  data: AgentImageModelsResponse | null;
  saving: boolean;
  saveFailed: boolean;
  choose: (id: string | null) => Promise<void>;
}

/** The daemon's list, refreshed when a pick is saved anywhere or the window regains focus. */
export function useAgentImageModels(): AgentImageModelsState {
  const [data, setData] = useState<AgentImageModelsResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const reload = useCallback(async () => {
    const next = await fetchAgentImageModels();
    if (next) setData(next);
  }, []);
  useEffect(() => {
    void reload();
    const onChange = () => { void reload(); };
    window.addEventListener(AGENT_IMAGE_MODEL_CHANGED_EVENT, onChange);
    window.addEventListener('focus', onChange);
    return () => {
      window.removeEventListener(AGENT_IMAGE_MODEL_CHANGED_EVENT, onChange);
      window.removeEventListener('focus', onChange);
    };
  }, [reload]);
  const choose = useCallback(async (id: string | null) => {
    setSaving(true);
    setSaveFailed(false);
    // Show the choice at once; the reload after saving confirms it.
    setData((current) => {
      if (!current) return current;
      const { selectedUnavailable: _previous, ...rest } = current;
      return { ...rest, selected: id };
    });
    const ok = await saveAgentImageModel(id);
    setSaving(false);
    if (!ok) {
      setSaveFailed(true);
      await reload();
    }
  }, [reload]);
  return { data, saving, saveFailed, choose };
}
