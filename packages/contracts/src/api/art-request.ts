// The art card: how an agent asks the user to approve art paid from the art budget
// when the project asks before spending. The agent writes it at the end of a reply;
// the chat draws it with an Approve button, and the click, never the agent, calls
// `POST /api/projects/:id/art-budget/approve`. One source for the syntax, shared by
// the prompt that teaches it and the chat that draws it.

import { parseArtApprovalCredits } from './art-budget.js';

export const ART_REQUEST_TAG = 'art-request';

/** At most this many lines are drawn; a longer list is cut with a count of the rest. */
export const ART_REQUEST_MAX_ITEMS = 24;

export interface ArtRequestCard {
  /** The total the user is asked to approve, in credits. */
  credits: number;
  /** One line per asset or group of assets, as the agent wrote them. */
  items: string[];
  /** Lines past `ART_REQUEST_MAX_ITEMS`. */
  hiddenItems: number;
}

/** The syntax, as the prompt shows it. */
export const ART_REQUEST_EXAMPLE = `<${ART_REQUEST_TAG} credits="32">
- Hero design: 1 image
- Hero idle, run, jump, hurt: 4 images
</${ART_REQUEST_TAG}>`;

const BLOCK = new RegExp(`<${ART_REQUEST_TAG}\\s+credits\\s*=\\s*"(\\d+)"\\s*>([\\s\\S]*?)</${ART_REQUEST_TAG}>`, 'giu');

/** Where each complete card sits in the text, so a renderer can cut it out. */
export function findArtRequestBlocks(text: string): Array<{ start: number; end: number; card: ArtRequestCard | null }> {
  const found: Array<{ start: number; end: number; card: ArtRequestCard | null }> = [];
  for (const match of text.matchAll(BLOCK)) {
    found.push({ start: match.index, end: match.index + match[0].length, card: cardFrom(match[1]!, match[2]!) });
  }
  return found;
}

/**
 * The card a message ends its turn with: the last complete, valid one. A card with
 * no credits or no lines is not a card, so nothing can be approved from it.
 */
export function parseArtRequest(text: string): ArtRequestCard | null {
  const blocks = findArtRequestBlocks(text);
  for (let index = blocks.length - 1; index >= 0; index--) {
    const card = blocks[index]!.card;
    if (card) return card;
  }
  return null;
}

function cardFrom(rawCredits: string, body: string): ArtRequestCard | null {
  const credits = parseArtApprovalCredits(Number(rawCredits));
  if (credits === null) return null;
  const lines = body.split(/\r?\n/u).map(line => line.trim().replace(/^[-*•]\s*/u, '').trim()).filter(Boolean);
  if (lines.length === 0) return null;
  return { credits, items: lines.slice(0, ART_REQUEST_MAX_ITEMS), hiddenItems: Math.max(0, lines.length - ART_REQUEST_MAX_ITEMS) };
}
