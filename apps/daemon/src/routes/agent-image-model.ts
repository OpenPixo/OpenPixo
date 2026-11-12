import type { Express, RequestHandler } from 'express';
import { OPENPIXO_MEDIA_PROVIDER_ID, type AgentImageModelOption, type AgentImageModelsResponse } from '@openpixo/contracts';
import { agentImageChoiceStatus, gameMediaModelCatalog } from '../game/media-contract.js';
import { IMAGE_MODELS, findProvider, findTextToImageModel, type MediaModel } from '../media/models.js';

export interface AgentImageModelFacts {
  /** Providers that can make something now, as a run reads them. */
  usableProviders: readonly string[];
  /** Signed in to the cloud: a hosted model can run in a project whose art budget can pay. */
  signedIn: boolean;
  /** The saved `agentImageModel`. */
  selected: string | undefined;
}

const CODEX_IMAGE_MODEL = 'codex-image';

function option(model: MediaModel, available: boolean): AgentImageModelOption {
  return {
    id: model.id,
    label: model.label,
    provider: model.provider,
    providerLabel: findProvider(model.provider)?.label ?? model.provider,
    hosted: model.provider === OPENPIXO_MEDIA_PROVIDER_ID,
    available,
  };
}

/**
 * The choices the user has for the agent's image model on this machine. A run decides
 * the same way (`gameMediaModelCatalog`), except that a hosted model also needs that
 * project's art budget, which a global setting cannot know: it is offered when signed in.
 */
export function agentImageModelChoices(facts: AgentImageModelFacts): AgentImageModelsResponse {
  const catalog = gameMediaModelCatalog(facts.usableProviders, facts.signedIn);
  const offered = new Set(catalog.image);
  const runnable = IMAGE_MODELS.filter((model) => model.caps.includes('t2i') && offered.has(model.id));
  // Codex first, as automatic prefers it; hosted last, as it spends credits.
  const rank = (model: MediaModel) => model.id === CODEX_IMAGE_MODEL ? 0 : model.provider === OPENPIXO_MEDIA_PROVIDER_ID ? 2 : 1;
  const options = [...runnable].sort((a, b) => rank(a) - rank(b)).map((model) => option(model, true));
  const saved = facts.selected?.trim() || null;
  const status = saved ? agentImageChoiceStatus(saved, facts.usableProviders, facts.signedIn) : null;
  const known = saved ? findTextToImageModel(saved) : null;
  const selected = known?.id ?? saved;
  if (selected && status && !status.ok) {
    options.push(known ? option(known, false) : { id: selected, label: selected, provider: '', providerLabel: '', hosted: false, available: false });
  }
  return {
    selected,
    automatic: catalog.defaultImageModel ?? null,
    ...(status && !status.ok ? { selectedUnavailable: status.reason } : {}),
    options,
  };
}

export interface RegisterAgentImageModelRoutesDeps {
  http: { requireLocalDaemonRequest: RequestHandler };
  readFacts: () => Promise<AgentImageModelFacts>;
}

/**
 * `GET /api/media/agent-image-models`, read by the Settings select, the composer chip
 * and `pixo media image-models`. The pick itself is written through `PUT /api/app-config`
 * (`agentImageModel`), like every other app preference.
 */
export function registerAgentImageModelRoutes(app: Express, deps: RegisterAgentImageModelRoutesDeps): void {
  app.get('/api/media/agent-image-models', deps.http.requireLocalDaemonRequest, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.json(agentImageModelChoices(await deps.readFacts()));
    } catch {
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Unable to read the image models' } });
    }
  });
}
