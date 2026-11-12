import type { PluginUseAction } from '../plugins-home/useActions';

export interface HomePromptHandoff {
  id: number;
  pluginId: string;
  focus: boolean;
  source: 'plugin-use';
  action: PluginUseAction;
  inputs?: Record<string, unknown>;
  /** The originating surface already recorded this use click. */
  useTracked?: boolean;
}

export function createPluginUseHandoff(
  id: number,
  pluginId: string,
  options: {
    action?: PluginUseAction;
    inputs?: Record<string, unknown>;
    useTracked?: boolean;
  } = {},
): HomePromptHandoff {
  return {
    id,
    pluginId,
    action: options.action ?? 'use',
    ...(options.inputs ? { inputs: options.inputs } : {}),
    ...(options.useTracked ? { useTracked: true } : {}),
    focus: true,
    source: 'plugin-use',
  };
}

// A one-shot selection survives navigation from plugin details to Home.
let pendingHomePromptHandoff: HomePromptHandoff | null = null;

export function stashHomePromptHandoff(handoff: HomePromptHandoff): void {
  pendingHomePromptHandoff = handoff;
}

export function takeHomePromptHandoff(): HomePromptHandoff | null {
  const handoff = pendingHomePromptHandoff;
  pendingHomePromptHandoff = null;
  return handoff;
}
