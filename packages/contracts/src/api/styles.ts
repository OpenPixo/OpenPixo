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

/** Art-style facts explicitly supplied to the shared game prompt. */
export type ProjectArtStylePromptInput = Pick<ArtStyle, 'id' | 'title' | 'prompt' | 'negativePrompt' | 'palette' | 'constraints'>;
