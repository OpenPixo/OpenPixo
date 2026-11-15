/**
 * `pixo look`: the OpenPixo-credits agent's eyes. Its runtime is told it reads text only,
 * so no picture enters its conversation (a picture dropped from a long conversation breaks
 * the prompt cache for every token after it). It asks about one image at a time instead;
 * the daemon sends that image and the question to {@link OPENPIXO_AGENT_IMAGE_VIEWER_MODEL}
 * on the run's own credits, and only the text answer goes back into the conversation.
 */

/** The hosted model that answers looks. It must be listed by the cloud as reading images. */
export const OPENPIXO_AGENT_IMAGE_VIEWER_MODEL = 'openpixo-agent-claude-haiku-5-5';

/** Longest question one look takes. */
export const IMAGE_LOOK_QUESTION_MAX_CHARS = 4000;

/** Largest image file one look reads, before it is fitted. */
export const IMAGE_LOOK_MAX_FILE_BYTES = 20 * 1024 * 1024;

/** The file types a look reads; the content must be one of these too. */
export const IMAGE_LOOK_FILE_EXTENSIONS: readonly string[] = Object.freeze(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/** `POST /api/tools/look`, with the run's tool token. */
export interface ImageLookRequest {
  /** A project file (project-relative or absolute inside the project), or a verification image path the host returned. */
  path: string;
  /** What to check in the image, 1 to {@link IMAGE_LOOK_QUESTION_MAX_CHARS} characters. */
  question: string;
}

export interface ImageLookResponse {
  answer: string;
  /** The model that answered. */
  model: string;
  /** What this look added to the run's charge, as the cloud settled it; 0 when it did not say. */
  creditsCharged: number;
  costMicrocredits: number;
}
