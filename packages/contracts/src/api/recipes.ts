import { z } from 'zod';
import { isRecipeRelativePath, type PluginManifest, type Recipe, type RecipeDimension, type RecipeSurface } from '../plugins/manifest.js';

export interface RecipeSummary {
  id: string;
  title: string;
  title_i18n?: PluginManifest['title_i18n'];
  description: string;
  description_i18n?: PluginManifest['description_i18n'];
  version: string;
  surface: RecipeSurface;
  category: string;
  engines: string[];
  requires: string[];
  /** True only after the recipe's real-provider evaluation has passed; absent means false. */
  verified?: boolean;
  preview?: string;
  examples?: PluginManifest['examples'];
  whenToUse?: string;
  dimension?: RecipeDimension[];
  acts?: Recipe['acts'];
}
export interface RecipeDetail extends RecipeSummary { manifest: PluginManifest }
export interface RecipeQuote { credits: number }
export interface RecipeCandidate {
  id: string;
  index: number;
  stagedFiles: Array<{ role: 'primary' | 'derived'; ref: string; mime: string }>;
  checks: Array<{ check: string; ok: boolean; detail?: string }>;
  adoptedPaths?: string[];
  mediaTaskId?: string;
  error?: string;
  errorCode?: string;
  errorReason?: string;
}
/** Who started a run, decided by the daemon from the request's tool token, never from its body. */
export type RecipeRunOrigin = 'user' | 'agent';
export interface RecipeRun {
  id: string;
  projectId: string;
  recipeId: string;
  recipeVersion: string;
  /** Absent on runs recorded before the generator history existed. */
  surface?: Exclude<RecipeSurface, 'code'>;
  /** Absent on runs recorded before the generator history existed. */
  origin?: RecipeRunOrigin;
  styleId?: string | null;
  inputs: Record<string, unknown>;
  model: { provider: string; id: string };
  status: 'queued' | 'generating' | 'postprocessing' | 'ready' | 'failed' | 'cancelled';
  candidates: RecipeCandidate[];
  quote?: RecipeQuote;
  error?: string;
  errorCode?: string;
  errorReason?: string;
  createdAt: number;
  updatedAt: number;
}
export const RecipeRunRequestSchema = z.object({
  recipeId: z.string().min(1),
  inputs: z.record(z.unknown()).default({}),
  model: z.string().min(1).optional(),
  styleId: z.string().min(1).nullable().optional(),
  count: z.number().int().min(1).max(32).optional(),
  prompt: z.string().min(1).optional(),
  conversationId: z.string().optional(),
  agentId: z.string().optional(),
  /** A price the user confirmed (`POST …/recipe-runs/quote`); the run must ask for exactly what was priced. */
  quoteId: z.string().uuid().optional(),
}).strict();
export type RecipeRunRequest = z.infer<typeof RecipeRunRequestSchema>;

/** What `POST /api/projects/:id/recipe-runs/quote` prices: a run request, without a quote or a chat. */
export const RecipeQuoteRequestSchema = RecipeRunRequestSchema.omit({ quoteId: true, conversationId: true, agentId: true });
export type RecipeQuoteRequest = z.infer<typeof RecipeQuoteRequestSchema>;

/**
 * The answer to a quote request. `paid: false` means a tool of the user's own makes
 * it and nothing is spent: run it without a quote. `paid: true` is a price for every
 * candidate, held by the daemon until it expires; passing `quoteId` with the same
 * request spends exactly that, once.
 */
export type RecipeRunQuote =
  | { paid: false; model: { provider: string; id: string }; count: number }
  | { paid: true; quoteId: string; model: { provider: string; id: string }; count: number;
      /** Total of `candidates`. */
      credits: number;
      /** Credits the account had free when this was priced. */
      available: number;
      candidates: Array<{ credits: number }>;
      expiresAt: string;
      warnings: string[] };

/** `GET /api/projects/:id/recipe-runs`, newest first. */
export interface RecipeRunListResponse { runs: RecipeRun[] }
export const RecipeAdoptRequestSchema = z.object({ candidateIds: z.array(z.string().min(1)).min(1).max(32) }).strict();
export type RecipeAdoptRequest = z.infer<typeof RecipeAdoptRequestSchema>;
export interface RecipeCodeRunResponse { query: string; missingSkills: string[]; runId?: string; status: 'missing-skills' | 'started' }
export type RecipeRunResponse = RecipeRun | RecipeCodeRunResponse;
export type RecipeListResponse = RecipeSummary[];
export type RecipeAdoptResponse = RecipeRun;
export type RecipeCancelResponse = RecipeRun;

export const CharacterCardSchema = z.object({
  slug: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(20_000),
  references: z.array(z.string().refine(isRecipeRelativePath, 'Reference must be project-relative with no ..')).max(5).default([]),
  style: z.string().max(2000).default(''),
  notes: z.string().max(20_000).default(''),
}).strict();
export type CharacterCard = z.infer<typeof CharacterCardSchema>;
export type CharacterListResponse = CharacterCard[];
export type CharacterCreateRequest = CharacterCard;
export type CharacterUpdateRequest = Partial<Omit<CharacterCard, 'slug'>>;
export interface CharacterDeleteResponse { deleted: true }
