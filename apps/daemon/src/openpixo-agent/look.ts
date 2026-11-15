import path from 'node:path';
import sharp from 'sharp';
import {
  API_ERROR_CODES, IMAGE_LOOK_FILE_EXTENSIONS, IMAGE_LOOK_MAX_FILE_BYTES, IMAGE_LOOK_QUESTION_MAX_CHARS, OPENPIXO_AGENT_IMAGE_VIEWER_MODEL,
  type ImageLookRequest, type ImageLookResponse,
} from '@openpixo/contracts';
import { record } from '../account/supabase.js';
import type { OpenPixoAgentGateway } from './gateway.js';
import { fitImageDataUrl, MAX_ONE_IMAGE_BYTES, type FittedImageCache } from './inline-images.js';

/**
 * `pixo look`: one image and one question, answered in text by the hosted image viewer on the
 * run's credits. The hosted agent's runtime is told it reads text only, so no picture ever enters
 * its conversation; text appended to a conversation never breaks its prompt cache, while a picture
 * dropped from it does, for every token after it.
 */

/** Short answers: the agent asks again for more. */
const LOOK_MAX_TOKENS = 800;
const LOOK_SYSTEM_PROMPT = [
  'You are the eyes of an agent that is building a video game and cannot see images itself.',
  'Answer its question about this one image, and only that question.',
  'Be exact about visible text (quote it), counts, positions, sizes, colours, overlaps, cut-off parts, and blank or missing areas.',
  'Say plainly when something cannot be told from the image. Never guess.',
  'No preamble and no closing remarks.',
].join(' ');
const FORMAT_MIME: Readonly<Record<string, string>> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

export class ImageLookError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** The request as sent, or why it cannot be. */
export function parseImageLookRequest(value: unknown): ImageLookRequest {
  const body = record(value);
  if (typeof body.path !== 'string' || !body.path.trim() || body.path.length > 4096 || body.path.includes('\0')) {
    throw new ImageLookError(400, 'BAD_REQUEST', 'Pass the image path to look at.');
  }
  if (typeof body.question !== 'string' || !body.question.trim()) {
    throw new ImageLookError(400, 'BAD_REQUEST', 'Ask a question about the image (--question): what should be checked in it?');
  }
  if (body.question.length > IMAGE_LOOK_QUESTION_MAX_CHARS) {
    throw new ImageLookError(400, 'BAD_REQUEST', `Keep the question under ${IMAGE_LOOK_QUESTION_MAX_CHARS} characters.`);
  }
  return { path: body.path, question: body.question.trim() };
}

export function assertImageLookExtension(file: string): void {
  if (!IMAGE_LOOK_FILE_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
    throw new ImageLookError(415, 'UNSUPPORTED_MEDIA_TYPE', `pixo look reads ${IMAGE_LOOK_FILE_EXTENSIONS.join(', ')} images only.`);
  }
}

/**
 * The image as the viewer is sent it: fitted by the same rule as the agent's own pictures, so the
 * same file always becomes the same bytes. The content decides the type, not the file name.
 */
export async function imageLookDataUrl(bytes: Buffer, cache?: FittedImageCache): Promise<string> {
  if (bytes.length > IMAGE_LOOK_MAX_FILE_BYTES) {
    throw new ImageLookError(413, 'PAYLOAD_TOO_LARGE', `The image is larger than ${IMAGE_LOOK_MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }
  let format: string | undefined;
  try { format = (await sharp(bytes, { failOn: 'none' }).metadata()).format; } catch { format = undefined; }
  const mime = format ? FORMAT_MIME[format] : undefined;
  if (!mime) throw new ImageLookError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The file is not a PNG, JPEG, WebP or GIF image.');
  const fitted = await fitImageDataUrl(`data:${mime};base64,${bytes.toString('base64')}`, cache);
  if (fitted.length > MAX_ONE_IMAGE_BYTES) {
    throw new ImageLookError(413, 'PAYLOAD_TOO_LARGE', 'The image could not be made small enough to send. Crop it or look at a smaller copy.');
  }
  return fitted;
}

/** The chat-completions body one look sends: the viewer model, the question, the one image. */
export function imageLookBody(question: string, dataUrl: string): Record<string, unknown> {
  return {
    model: OPENPIXO_AGENT_IMAGE_VIEWER_MODEL,
    stream: false,
    max_tokens: LOOK_MAX_TOKENS,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: LOOK_SYSTEM_PROMPT },
      { role: 'user', content: [{ type: 'text', text: question }, { type: 'image_url', image_url: { url: dataUrl } }] },
    ],
  };
}

/** The assistant's text in a chat-completions response; empty when it has none. */
export function imageLookAnswer(response: unknown): string {
  const choices = record(response).choices;
  const message = record(Array.isArray(choices) ? record(choices[0]).message : null);
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    const item = record(part);
    return item.type === 'text' && typeof item.text === 'string' ? item.text : '';
  }).join('').trim();
}

/** The cloud's own code when the API knows it; otherwise whether trying again later can help. */
function lookErrorCode(code: string, status: number): string {
  if ((API_ERROR_CODES as readonly string[]).includes(code)) return code;
  return status === 429 || status >= 500 ? 'UPSTREAM_UNAVAILABLE' : 'BAD_REQUEST';
}

/** Sends one look for a running hosted run and returns its answer and what it cost. */
export async function lookThroughGateway(gateway: OpenPixoAgentGateway, runId: string, question: string, dataUrl: string,
  signal: AbortSignal): Promise<ImageLookResponse> {
  const result = await gateway.sideRequest(runId, Buffer.from(JSON.stringify(imageLookBody(question, dataUrl))), signal);
  if (!result.ok) throw new ImageLookError(result.status, lookErrorCode(result.code, result.status), result.message);
  const answer = imageLookAnswer(result.body);
  if (!answer) throw new ImageLookError(502, 'UPSTREAM_UNAVAILABLE', 'The image viewer gave no answer. Look again with a more specific question.');
  return {
    answer,
    model: result.usage?.model || OPENPIXO_AGENT_IMAGE_VIEWER_MODEL,
    creditsCharged: result.usage?.creditsCharged ?? 0,
    costMicrocredits: result.usage?.costMicrocredits ?? 0,
  };
}
