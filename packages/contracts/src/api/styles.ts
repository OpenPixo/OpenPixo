import { z } from 'zod';
import type { ArtStyleDefinition, PluginExample, PluginManifest } from '../plugins/manifest.js';

/** Localized style data shared by Store, Studio, the project default and CLI. */
export interface ArtStyle extends ArtStyleDefinition {
  title: string;
  title_i18n?: PluginManifest['title_i18n'];
  description: string;
  description_i18n?: PluginManifest['description_i18n'];
  examples?: PluginExample[];
  license: string;
}

export interface StylesResponse { styles: ArtStyle[] }
export interface StyleResponse { style: ArtStyle }
export interface ProjectArtStyleResponse {
  styleId: string | null;
  style: ArtStyle | null;
  /** Project-relative image new art should match (`metadata.styleReference`); null when none is set. */
  referenceImage: string | null;
}
export const SetProjectArtStyleRequestSchema = z.object({ styleId: z.string().min(1).nullable() }).strict();
export type SetProjectArtStyleRequest = z.infer<typeof SetProjectArtStyleRequestSchema>;
/** `PUT /api/projects/:id/style-reference`: a project-relative image path, or null to clear it. */
export const SetProjectStyleReferenceRequestSchema = z.object({ path: z.string().min(1).max(1024).nullable() }).strict();
export type SetProjectStyleReferenceRequest = z.infer<typeof SetProjectStyleReferenceRequestSchema>;

/** Omission inherits the project default; null explicitly disables the style for one generation. */
export type GenerationStyleId = string | null;

/**
 * Art-style facts explicitly supplied to the shared game prompt. `advisory` is
 * set once the user has their own direction (`projectHasUserArtDirection`): the
 * style is then a starting point the prompt mentions, never a rule.
 */
export type ProjectArtStylePromptInput = Pick<ArtStyle, 'id' | 'title' | 'prompt' | 'negativePrompt' | 'palette' | 'constraints'> & {
  advisory?: boolean | undefined;
};

/**
 * Whether the user has set the look of this game themselves: a picked style
 * sample or reference (`metadata.styleReference`), or written direction or
 * reference images in Game setup.
 *
 * Owner decision (2026-11-16): an installed style is a starting point that seeds
 * planning's style samples, never a limit on the look. Once this holds, the host
 * stops adding the project's style to image requests (an explicit `styleId`
 * still applies it) and the prompt calls the style advisory. Before, the preset's
 * brushwork, palette and outline rules were added to every image, and overrode a
 * bold flat look the agent asked for.
 */
export function projectHasUserArtDirection(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const record = metadata as { styleReference?: unknown; gameSetup?: unknown };
  if (typeof record.styleReference === 'string' && record.styleReference.trim()) return true;
  const art = record.gameSetup && typeof record.gameSetup === 'object'
    ? (record.gameSetup as { art?: unknown }).art
    : undefined;
  if (!art || typeof art !== 'object') return false;
  const { direction, references } = art as { direction?: unknown; references?: unknown };
  return (typeof direction === 'string' && direction.trim().length > 0)
    || (Array.isArray(references) && references.length > 0);
}
