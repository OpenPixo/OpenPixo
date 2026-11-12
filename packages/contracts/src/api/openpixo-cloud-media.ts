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

export type OpenPixoGenerationAspect = '1:1' | '2:3' | '3:2' | '4:3' | '3:4' | '16:9' | '9:16';

/** Server-side price rules beyond the base price; all amounts are credits. */
export interface OpenPixoGenerationPricing {
  /** Prompts estimated above this many tokens cost `longPromptCredits` more. */
  longPromptTokens: number;
  longPromptCredits: number;
  /** Prompts estimated above this many tokens are refused. */
  maxPromptTokens: number;
  /** Each reference image beyond the first. */
  extraReferenceCredits: number;
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
  breakdown: { base: number; longPrompt: number; extraReferences: number };
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
