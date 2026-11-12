/** The hosted text-to-image service: it takes no reference images. */
export const OPENPIXO_IMAGE_MODEL = 'openpixo-image';
/** The hosted image service that takes 1 to 4 reference images. */
export const OPENPIXO_IMAGE_EDIT_MODEL = 'openpixo-image-edit';

/** How many reference images a media request body carries (`image`, `images`, or both for the first). */
export function referenceImageCount(body: { image?: unknown; images?: unknown } | null | undefined): number {
  if (Array.isArray(body?.images) && body.images.length > 0) return body.images.length;
  return typeof body?.image === 'string' && body.image.trim() ? 1 : 0;
}

/**
 * Why an agent's image request is refused before anything is priced: the game has a
 * style reference and the request neither passes it (or any image) as `--image` nor says
 * `--no-reference`. The agent still decides; it only has to say which (owner, 2026-11-11).
 * Not attaching it keeps backgrounds, UI and art meant to look different free. A note on
 * the result was ignored by DeepSeek V4.1 Flash in a real run; a refusal it must answer.
 */
export function styleReferenceRefusal(reference: string | null, referenceCount: number, noReference: unknown): string | null {
  if (!reference || referenceCount > 0 || noReference === true) return null;
  return `This game has a style reference, ${reference}. Send the request again with --image ${reference} so the new art matches the game, or with --no-reference when this art is meant to look different (a background, UI, a new style). Nothing was spent.`;
}

export interface HostedImageModelChoice {
  model: string;
  /** Said to the agent in the file's warnings when the model was changed. */
  note?: string;
}

/**
 * An agent's hosted image request goes to the hosted image service that can take
 * what it sent: with reference images, `openpixo-image-edit`; without, `openpixo-image`.
 *
 * The agent's image model list shows only `openpixo-image`, so a weaker model asked to
 * match a style reference passed it there, where it cannot be used, or left it out
 * (2026-11-11 skill test on DeepSeek V4.1 Flash). Choosing the service from the
 * references keeps the style reference in the request. Only an agent's request is
 * changed: one the user confirmed must reach the cloud as it was quoted.
 */
export function hostedImageModelForReferences(model: string, referenceCount: number): HostedImageModelChoice {
  if (model === OPENPIXO_IMAGE_MODEL && referenceCount > 0) {
    return { model: OPENPIXO_IMAGE_EDIT_MODEL, note: `made with ${OPENPIXO_IMAGE_EDIT_MODEL}, the hosted model that takes reference images` };
  }
  if (model === OPENPIXO_IMAGE_EDIT_MODEL && referenceCount === 0) {
    return { model: OPENPIXO_IMAGE_MODEL, note: `made with ${OPENPIXO_IMAGE_MODEL}: no reference image was passed (--image)` };
  }
  return { model };
}
