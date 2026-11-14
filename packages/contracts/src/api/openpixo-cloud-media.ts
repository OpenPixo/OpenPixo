/**
 * Hosted media generation paid with OpenPixo credits.
 *
 * The daemon serves the catalogue and quotes under `/api/openpixo/cloud-media/*`;
 * generation itself goes through the shared media route
 * (`POST /api/projects/:id/media/generate`) with an `openpixo-*` model, a
 * `quoteId` the user confirmed and a stable `cloudRequestId`. The cloud prices
 * every request, reserves credits, and settles them only once a real artifact can
 * be delivered; a failure releases the reservation.
 */

/** Daemon media model ids double as cloud service ids. */
export const OPENPIXO_MEDIA_PROVIDER_ID = 'openpixo';

/** The hosted 3D service at its default, medium quality. It works from its reference image alone. */
export const OPENPIXO_MODEL3D_SERVICE = 'openpixo-model3d';

/** Hosted 3D comes in three quality tiers; `medium` is the default. */
export type OpenPixoModel3dQuality = 'draft' | 'medium' | 'high';
export const OPENPIXO_MODEL3D_QUALITIES: readonly OpenPixoModel3dQuality[] = ['draft', 'medium', 'high'];
export const OPENPIXO_MODEL3D_DEFAULT_QUALITY: OpenPixoModel3dQuality = 'medium';
/** The service id behind each tier. Medium keeps the id app 1.0.1 knows. */
export const OPENPIXO_MODEL3D_SERVICES: Readonly<Record<OpenPixoModel3dQuality, string>> = {
  draft: 'openpixo-model3d-draft',
  medium: OPENPIXO_MODEL3D_SERVICE,
  high: 'openpixo-model3d-high',
};

/** Whether a hosted service id is one of the 3D tiers, which all take a reference image and no prompt. */
export function isOpenPixoModel3dService(id: unknown): boolean {
  return typeof id === 'string' && Object.values(OPENPIXO_MODEL3D_SERVICES).includes(id);
}

/** What is quoted and sent as a 3D service's prompt, whatever a caller typed, so a quote never drifts. */
export const OPENPIXO_MODEL3D_PROMPT = 'A textured 3D model of the object in the reference image.';

export type OpenPixoGenerationAspect = '1:1' | '2:3' | '3:2' | '4:3' | '3:4' | '16:9' | '9:16' | '21:9';
/** Every shape, in the order a picker shows them. `21:9` is listed only to apps that ask for `generation-services?v=4`. */
export const OPENPIXO_GENERATION_ASPECTS: readonly OpenPixoGenerationAspect[] = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];

/** How large a hosted image is: about 1, 4 or 8 megapixels. `1k` is the default and the base price. */
export type OpenPixoGenerationResolution = '1k' | '2k' | '4k';
export const OPENPIXO_GENERATION_RESOLUTIONS: readonly OpenPixoGenerationResolution[] = ['1k', '2k', '4k'];
export const OPENPIXO_GENERATION_DEFAULT_RESOLUTION: OpenPixoGenerationResolution = '1k';

/**
 * The pixel size a hosted image service renders for each resolution and shape. Both edges are
 * multiples of 16, no edge is over 3840 and no image is over 8,294,400 pixels, which is what the
 * image model takes. 1K keeps the sizes price version 2 sold.
 */
export const OPENPIXO_IMAGE_SIZES: Readonly<Record<OpenPixoGenerationResolution, Readonly<Record<OpenPixoGenerationAspect, { width: number; height: number }>>>> = {
  '1k': {
    '1:1': { width: 1024, height: 1024 }, '4:3': { width: 1024, height: 768 }, '3:4': { width: 768, height: 1024 },
    '16:9': { width: 1360, height: 768 }, '9:16': { width: 768, height: 1360 }, '3:2': { width: 1536, height: 1024 },
    '2:3': { width: 1024, height: 1536 }, '21:9': { width: 1792, height: 768 },
  },
  '2k': {
    '1:1': { width: 2048, height: 2048 }, '4:3': { width: 2304, height: 1728 }, '3:4': { width: 1728, height: 2304 },
    '16:9': { width: 2560, height: 1440 }, '9:16': { width: 1440, height: 2560 }, '3:2': { width: 2304, height: 1536 },
    '2:3': { width: 1536, height: 2304 }, '21:9': { width: 2688, height: 1152 },
  },
  '4k': {
    '1:1': { width: 2880, height: 2880 }, '4:3': { width: 3264, height: 2448 }, '3:4': { width: 2448, height: 3264 },
    '16:9': { width: 3840, height: 2160 }, '9:16': { width: 2160, height: 3840 }, '3:2': { width: 3456, height: 2304 },
    '2:3': { width: 2304, height: 3456 }, '21:9': { width: 3840, height: 1648 },
  },
};

/** Server-side price rules beyond the base price; all amounts are credits. */
export interface OpenPixoGenerationPricing {
  /** Prompts estimated above this many tokens cost `longPromptCredits` more. */
  longPromptTokens: number;
  longPromptCredits: number;
  /** Prompts estimated above this many tokens are refused. */
  maxPromptTokens: number;
  /** Each reference image beyond the first. */
  extraReferenceCredits: number;
  /** Credits added for a resolution above `1k`; absent for a service with one size. */
  resolutionCredits?: Partial<Record<OpenPixoGenerationResolution, number>>;
}

export type OpenPixoGenerationAudioKind = 'sfx' | 'speech' | 'music';

export interface OpenPixoGenerationService {
  /** Also the daemon media model id, e.g. `openpixo-image`. */
  id: string;
  surface: 'image' | 'audio' | 'model3d';
  /** Which kind of sound an audio service makes. */
  audioKind?: OpenPixoGenerationAudioKind;
  /** Which quality tier a 3D service is. */
  quality?: OpenPixoModel3dQuality;
  label: string;
  /** Base credits per successful file; 1 credit = US$0.01. Quotes add the surcharges in `pricing`. */
  credits: number;
  priceVersion: number;
  maxPromptChars: number;
  /** Shortest prompt the service takes; absent means any non-empty prompt. */
  minPromptChars?: number;
  /** The length a service lets you choose, in seconds; absent means it can't be chosen. */
  durationSeconds?: { min: number; max: number; default: number };
  /** Empty when the service takes no shape, which is every audio service. */
  aspects: OpenPixoGenerationAspect[];
  /** The resolutions an image service renders, `1k` first; absent means `1k` only. */
  resolutions?: OpenPixoGenerationResolution[];
  /** Fixed style presets; for a speech service, its voices. Empty when the service has none. */
  styles: string[];
  /** How many reference images the service takes; `{ min: 0, max: 0 }` for text-to-image. */
  references: { min: number; max: number };
  pricing: OpenPixoGenerationPricing;
}

export interface OpenPixoGenerationServicesResponse {
  services: OpenPixoGenerationService[];
  /** True while the operator has paused new hosted generation. */
  generationPaused: boolean;
}

/** Only these parameters reach the vendor; anything else is rejected. */
export interface OpenPixoGenerationParams {
  prompt: string;
  aspect?: OpenPixoGenerationAspect;
  /** For a service with `resolutions`; absent means `1k`. */
  resolution?: OpenPixoGenerationResolution;
  style?: string;
  /** Seconds, for a service with `durationSeconds`. The cloud refuses it anywhere else. */
  duration?: number;
  /**
   * SHA-256 (hex) of reference images already uploaded with
   * `generation-reference`, in order. The daemon fills this from project files.
   */
  references?: string[];
}

export interface OpenPixoGenerationQuoteRequest {
  service: string;
  params: OpenPixoGenerationParams;
}

/**
 * A server-priced offer bound to the signed-in user, the service and these exact
 * parameters. One quote pays for one job; it expires unused.
 */
export interface OpenPixoGenerationQuote {
  quoteId: string;
  service: string;
  credits: number;
  priceVersion: number;
  /** SHA-256 of the canonical service + parameters. */
  paramsDigest: string;
  expiresAt: string;
  /** Available credits when the quote was made (reserved credits excluded). */
  available: number;
  /** How `credits` was reached. */
  breakdown: { base: number; longPrompt: number; extraReferences: number; resolution?: number };
}

/**
 * How the app and the vendor exchange files. `direct` moves them between the two with the
 * cloud handing out links; a cloud or vendor that cannot do that falls back to its own storage.
 */
export type OpenPixoGenerationDelivery = 'direct';

/** Register a reference image once, under its hash. */
export interface OpenPixoGenerationReferenceRequest {
  sha256: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: number;
  delivery?: OpenPixoGenerationDelivery;
}

export interface OpenPixoGenerationReferenceResponse {
  sha256: string;
  /** One-time upload URL; null when this image is already there. */
  uploadUrl: string | null;
}

/**
 * - `queued`: credits reserved, not yet sent to the vendor.
 * - `running`: the vendor is generating, or the result is being checked.
 * - `checking`: the vendor may have accepted the job but did not confirm it;
 *   credits stay reserved and the job is never resubmitted automatically.
 * - `succeeded`: the artifact can be downloaded and credits are settled.
 * - `failed`: nothing deliverable; the reservation was released.
 */
export type OpenPixoGenerationJobState = 'queued' | 'running' | 'checking' | 'succeeded' | 'failed';

export interface OpenPixoGenerationArtifact {
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'audio/mpeg' | 'model/gltf-binary';
  bytes: number;
  /** Null on direct delivery, where the cloud never reads the whole file. */
  sha256: string | null;
}

export interface OpenPixoGenerationJob {
  jobId: string;
  service: string;
  state: OpenPixoGenerationJobState;
  creditsReserved: number;
  /** Set once settled. */
  creditsCharged: number | null;
  /** Stable failure code when `state` is `failed`. */
  errorCode: string | null;
  artifact: OpenPixoGenerationArtifact | null;
  createdAt: string;
  updatedAt: string;
}

/** Extra fields on `MediaGenerationRequest` for an `openpixo-*` model. */
export interface OpenPixoMediaGenerationFields {
  /** A quote the user confirmed; a request without one never spends credits. */
  quoteId: string;
  /**
   * Stable business id reused by every retry of the same confirmed request, so a
   * retry can never create a second paid job. Generated by the caller.
   */
  cloudRequestId: string;
  style?: string;
}

/** Cloud → daemon job response; the daemon downloads `download.url` and never forwards it. */
export interface OpenPixoCloudGenerationJob extends OpenPixoGenerationJob {
  /** Where to fetch the artifact once `succeeded`: signed cloud storage, or the vendor's link on direct delivery. */
  download: { url: string; expiresAt: string } | null;
}

/** A resolution written any way a person or an agent might (`2K`, `2k`), or undefined when it names none of them. */
export function parseOpenPixoResolution(value: unknown): OpenPixoGenerationResolution | undefined {
  const lower = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (OPENPIXO_GENERATION_RESOLUTIONS as readonly string[]).includes(lower) ? lower as OpenPixoGenerationResolution : undefined;
}

/** Credits a hosted image service adds for a resolution; 0 for `1k` or a service with one size. */
export function openPixoResolutionCredits(service: Pick<OpenPixoGenerationService, 'pricing'> | undefined, resolution: OpenPixoGenerationResolution | undefined): number {
  return resolution ? service?.pricing.resolutionCredits?.[resolution] ?? 0 : 0;
}

/** The resolution a hosted request sends: a larger one when asked for; `1k`, the default, goes unsaid. */
export function hostedResolution(value: unknown): Exclude<OpenPixoGenerationResolution, '1k'> | undefined {
  const parsed = parseOpenPixoResolution(value);
  return parsed === '1k' ? undefined : parsed;
}
