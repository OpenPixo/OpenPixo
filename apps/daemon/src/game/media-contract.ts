import { AUDIO_MODELS_BY_KIND, IMAGE_MODELS, MEDIA_PROVIDERS, MODEL3D_MODELS, VIDEO_MODELS, findMediaModel, findTextToImageModel, type MediaModel } from '../media/models.js';
import { readMaskedConfig, type MaskedConfigResponse } from '../media/config.js';
import { configuredRecipeProviders } from '../recipes/models.js';
import { OPENPIXO_MEDIA_PROVIDER_ID, renderGameMediaGenerationContract as renderCanonicalGameMediaContract, type AgentImageModelUnavailableReason, type ByokMediaDefaults, type EngineProfile, type GameMediaModelCatalog, type MediaExecutionPolicy } from '@openpixo/contracts';

/**
 * A run's media policy plus what can really render on this machine right now. The
 * policy says what the run may do; `usableProviders` keeps the prompt from offering
 * what is bound to fail. Omitted, only what an agent can never use is left out.
 */
export interface RunMediaExecution extends MediaExecutionPolicy {
  usableProviders?: readonly string[] | undefined;
  /** This project's art budget can pay for hosted images, audio and 3D models in this run. */
  budgetImages?: boolean | undefined;
  /** Signed in with no art budget set yet: credits could pay once the user sets one. */
  budgetUnset?: boolean | undefined;
}

/**
 * Whether an agent in a run can dispatch this provider on its own: hosted models spend
 * credits, so they come only with an art budget (`budgetImages`); the rest have no
 * renderer, or no skill that could drive one.
 */
const AGENT_DISPATCHABLE_PROVIDERS: ReadonlySet<string> = new Set(MEDIA_PROVIDERS
  .filter((provider) => provider.integrated && provider.id !== OPENPIXO_MEDIA_PROVIDER_ID && provider.id !== 'hyperframes' && provider.id !== 'stub')
  .map((provider) => provider.id));

/** Own tools first, like first-run setup (`setup-readiness.ts`): they cost nothing extra. */
const CODEX_IMAGE_MODEL = 'codex-image';

/**
 * Whether the image model the user picked (`agentImageModel`) can run with these
 * providers. A hosted one runs only when the art budget can pay, so picking it never
 * opens a way to spend credits around the budget.
 */
export function agentImageChoiceStatus(
  id: string,
  usableProviders: readonly string[] | undefined,
  budgetImages: boolean,
): { ok: true; id: string } | { ok: false; reason: AgentImageModelUnavailableReason } {
  const model = findTextToImageModel(id);
  if (!model) return { ok: false, reason: 'unknown-model' };
  if (model.provider === OPENPIXO_MEDIA_PROVIDER_ID) return budgetImages ? { ok: true, id: model.id } : { ok: false, reason: 'needs-art-budget' };
  const usable = AGENT_DISPATCHABLE_PROVIDERS.has(model.provider) && (!usableProviders || usableProviders.includes(model.provider));
  return usable ? { ok: true, id: model.id } : { ok: false, reason: 'not-connected' };
}

/**
 * The models an agent may dispatch in a run and the image model it starts from. The
 * user's Settings pick (`preferredImageModel`) is that default when it can run here;
 * otherwise the automatic one is, and the catalogue says why, so the agent can tell them.
 */
export function gameMediaModelCatalog(usableProviders?: readonly string[], budgetImages = false, preferredImageModel?: string | null, budgetUnset = false): GameMediaModelCatalog {
  const usable = (provider: string) => AGENT_DISPATCHABLE_PROVIDERS.has(provider)
    && (!usableProviders || usableProviders.includes(provider));
  const ids = (models: readonly MediaModel[]) => models.filter((model) => usable(model.provider)).map((model) => model.id);
  const own = ids(IMAGE_MODELS);
  const paid = budgetImages ? IMAGE_MODELS.filter((model) => model.provider === OPENPIXO_MEDIA_PROVIDER_ID).map((model) => model.id) : [];
  const textToImage = (models: readonly string[]) => IMAGE_MODELS.find((model) => models.includes(model.id) && model.caps.includes('t2i'))?.id;
  // Hosted audio and 3D come with the art budget too, after every own tool.
  const paidOf = (models: readonly MediaModel[]) => budgetImages ? models.filter((model) => model.provider === OPENPIXO_MEDIA_PROVIDER_ID).map((model) => model.id) : [];
  const budgetAudio = [AUDIO_MODELS_BY_KIND.sfx, AUDIO_MODELS_BY_KIND.speech, AUDIO_MODELS_BY_KIND.music].flatMap(paidOf);
  const budgetModel3d = paidOf(MODEL3D_MODELS);
  // With nothing known about this machine there is no honest automatic default to name.
  const automatic = !usableProviders ? undefined
    : own.includes(CODEX_IMAGE_MODEL) ? CODEX_IMAGE_MODEL
    : textToImage(own) ?? textToImage(paid);
  const choice = preferredImageModel?.trim() ? agentImageChoiceStatus(preferredImageModel, usableProviders, budgetImages) : null;
  return {
    image: [...own, ...paid],
    video: ids(VIDEO_MODELS),
    audioMusic: [...ids(AUDIO_MODELS_BY_KIND.music), ...paidOf(AUDIO_MODELS_BY_KIND.music)],
    audioSpeech: [...ids(AUDIO_MODELS_BY_KIND.speech), ...paidOf(AUDIO_MODELS_BY_KIND.speech)],
    audioSfx: [...ids(AUDIO_MODELS_BY_KIND.sfx), ...paidOf(AUDIO_MODELS_BY_KIND.sfx)],
    model3d: [...ids(MODEL3D_MODELS), ...budgetModel3d],
    defaultImageModel: choice?.ok ? choice.id : automatic,
    ...(choice?.ok ? { defaultImageModelIsUserChoice: true } : {}),
    ...(choice && !choice.ok ? { unavailableImageChoice: { id: preferredImageModel!.trim(), reason: choice.reason } } : {}),
    ...(paid.length ? { budgetImageModels: paid } : {}),
    ...(budgetAudio.length ? { budgetAudioModels: budgetAudio } : {}),
    ...(budgetModel3d.length ? { budgetModel3dModels: budgetModel3d } : {}),
    ...(budgetUnset && !budgetImages ? { artBudgetUnset: true } : {}),
  };
}

/** The providers that can make something now, read the way the recipe runner reads them. */
export function usableMediaProviders(config: Pick<MaskedConfigResponse, 'providers'>): string[] {
  return [...configuredRecipeProviders(config, false)].filter((provider) => AGENT_DISPATCHABLE_PROVIDERS.has(provider));
}

/** The image providers among those, which is what the art budget's default depends on. */
export function connectedImageTools(config: Pick<MaskedConfigResponse, 'providers'>): string[] {
  return usableMediaProviders(config).filter((provider) => IMAGE_MODELS.some((model) => model.provider === provider));
}

/**
 * The policy a run's prompt is composed from, with what can render attached. A
 * disabled run needs no probe. If the config cannot be read, or stubs stand in for
 * every model, the prompt keeps the full list rather than claiming nothing works.
 */
export async function runMediaExecutionForPrompt(
  mediaExecution: MediaExecutionPolicy | undefined,
  projectRoot: string,
  budgetImages = false,
  budgetUnset = false,
): Promise<RunMediaExecution | undefined> {
  if (mediaExecution?.mode === 'disabled') return mediaExecution;
  const withBudget = (execution: RunMediaExecution | undefined): RunMediaExecution | undefined =>
    budgetImages ? { mode: 'enabled', ...execution, budgetImages }
    : budgetUnset ? { mode: 'enabled', ...execution, budgetUnset }
    : execution;
  if (process.env.PIXO_MEDIA_ALLOW_STUBS === '1' || process.env.PIXO_MEDIA_ALLOW_STUBS === 'true') return withBudget(mediaExecution);
  try {
    const config = await readMaskedConfig(projectRoot, { refreshCredentials: false, cachedAgentDetection: true });
    return withBudget({ mode: 'enabled', ...mediaExecution, usableProviders: usableMediaProviders(config) });
  } catch {
    return withBudget(mediaExecution);
  }
}

/** A run default the user picked earlier may name a model that cannot run in this run. */
function usableRunDefaults(defaults: ByokMediaDefaults | undefined, catalog: GameMediaModelCatalog): ByokMediaDefaults | undefined {
  if (!defaults) return defaults;
  const offered = new Set([...catalog.image, ...catalog.video, ...catalog.audioSpeech]);
  // An id the registry does not know (a provider's live catalogue) cannot be judged here.
  const keep = (id: string | undefined) => {
    const known = id?.trim() ? findMediaModel(id.trim()) : null;
    return !known || offered.has(known.id);
  };
  const { imageModel, videoModel, speechModel, ...rest } = defaults;
  return {
    ...rest,
    ...(keep(imageModel) ? { imageModel } : {}),
    ...(keep(videoModel) ? { videoModel } : {}),
    ...(keep(speechModel) ? { speechModel } : {}),
  };
}

/**
 * `agentImageModel` is the user's Settings pick, read by the daemon for every run.
 * When it can run, it replaces a provider's own BYOK image default: the user chose it
 * on purpose, for every agent. A model the user names in chat still wins over both.
 */
export function renderGameMediaGenerationContract(
  mediaExecution?: RunMediaExecution | undefined,
  byokMediaDefaults?: ByokMediaDefaults | undefined,
  engineProfile?: EngineProfile | null | undefined,
  agentImageModel?: string | null | undefined,
): string {
  // A run limited to named models keeps its limit; a pick outside it is left out.
  const allowed = mediaExecution?.allowedModels;
  const preferred = agentImageModel && allowed?.length && !allowed.includes(findTextToImageModel(agentImageModel)?.id ?? agentImageModel)
    ? undefined
    : agentImageModel;
  const modelCatalog = gameMediaModelCatalog(mediaExecution?.usableProviders, mediaExecution?.budgetImages === true, preferred, mediaExecution?.budgetUnset === true);
  const runDefaults = usableRunDefaults(byokMediaDefaults, modelCatalog);
  const { imageModel: _byokImageModel, ...withoutImage } = runDefaults ?? {};
  return renderCanonicalGameMediaContract({
    mediaExecution,
    byokMediaDefaults: modelCatalog.defaultImageModelIsUserChoice && runDefaults ? withoutImage : runDefaults,
    engineProfile,
    modelCatalog,
  });
}
