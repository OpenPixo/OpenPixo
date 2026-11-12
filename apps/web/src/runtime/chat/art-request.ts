/**
 * Where an art card (`<art-request credits="…">…</art-request>`) sits in a reply, and
 * whether the user can approve it. The syntax and its parser are the shared contract
 * (`@openpixo/contracts` `api/art-request`); this file only cuts the blocks out of the
 * prose the chat draws and decides the card's state. No JSX, no DOM.
 */
import {
  ART_REQUEST_TAG,
  computeSkipRanges,
  findArtRequestBlocks,
  rangeContains,
  type ArtBudgetResponse,
  type ArtRequestCard,
} from '@openpixo/contracts';

export type ArtRequestSegment =
  | { kind: 'text'; text: string }
  /** `card` is null for a block that is not a valid card: it is hidden, never drawn as text. */
  | { kind: 'art-request'; card: ArtRequestCard | null };

/** Blocks quoted in code are examples, not cards. */
function liveBlocks(text: string) {
  if (!text.includes(`<${ART_REQUEST_TAG}`)) return [];
  const blocks = findArtRequestBlocks(text);
  if (blocks.length === 0) return blocks;
  const { ranges } = computeSkipRanges(text);
  return blocks.filter((block) => !rangeContains(ranges, block.start));
}

/** The prose around each complete art card, and the cards in their places. */
export function splitOnArtRequests(text: string): ArtRequestSegment[] {
  const blocks = liveBlocks(text);
  if (blocks.length === 0) return [{ kind: 'text', text }];
  const out: ArtRequestSegment[] = [];
  let cursor = 0;
  for (const block of blocks) {
    if (block.start > cursor) out.push({ kind: 'text', text: text.slice(cursor, block.start) });
    out.push({ kind: 'art-request', card: block.card });
    cursor = block.end;
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) });
  return out;
}

/**
 * The last valid card in the reply, the only one that can be approved. Same rule as
 * `parseArtRequest`, but a card quoted in code does not count.
 */
export function lastArtRequest(text: string): ArtRequestCard | null {
  const blocks = liveBlocks(text);
  for (let index = blocks.length - 1; index >= 0; index--) {
    const card = blocks[index]!.card;
    if (card) return card;
  }
  return null;
}

const OPEN_TAIL = new RegExp(`<${ART_REQUEST_TAG}\\b(?![\\s\\S]*</${ART_REQUEST_TAG}>)[\\s\\S]*$`, 'iu');

/**
 * While a reply streams, a card that has started but not closed is cut from the
 * prose, so `<art-request credits="32">` and its half-written lines never flash as
 * text. A half-typed opener at the very end (`<art-re`) is held back as well.
 */
export function stripTrailingOpenArtRequest(text: string): { text: string; hadOpenCard: boolean } {
  const { ranges } = computeSkipRanges(text);
  const match = OPEN_TAIL.exec(text);
  if (match && !rangeContains(ranges, match.index)) {
    return { text: text.slice(0, match.index), hadOpenCard: true };
  }
  const open = text.lastIndexOf('<');
  if (open >= 0 && !rangeContains(ranges, open)) {
    const tail = text.slice(open).toLowerCase();
    if (tail.length > 1 && `<${ART_REQUEST_TAG}`.startsWith(tail)) return { text: text.slice(0, open), hadOpenCard: true };
  }
  return { text, hadOpenCard: false };
}

export type ArtRequestStatus =
  /** The user can approve it now. */
  | { kind: 'ready' }
  /** The answer is already in the conversation. */
  | { kind: 'approved' }
  /** The conversation moved on without approving this card. */
  | { kind: 'stale' }
  /** A run is active; approving waits for it to end. */
  | { kind: 'busy' }
  /** The budget has not been read yet. */
  | { kind: 'loading' }
  | { kind: 'over-budget'; needed: number; left: number };

/**
 * What an art card lets the user do, in order of what matters: an answered or passed
 * card is history; a running turn makes approval wait; then the budget must cover it.
 */
export function artRequestStatus(input: {
  card: ArtRequestCard;
  /** This is the reply's last valid card, on the latest assistant turn. */
  latest: boolean;
  /** The user message that follows this reply, if any. */
  nextUserContent: string | undefined;
  /** The message an approval of this card sends, in the UI language. */
  approvalMessage: string;
  busy: boolean;
  budget: ArtBudgetResponse | null;
}): ArtRequestStatus {
  const { card, latest, nextUserContent, approvalMessage, busy, budget } = input;
  if (nextUserContent !== undefined) {
    return nextUserContent.trim() === approvalMessage.trim() ? { kind: 'approved' } : { kind: 'stale' };
  }
  if (!latest) return { kind: 'stale' };
  if (busy || budget?.runActive) return { kind: 'busy' };
  if (!budget) return { kind: 'loading' };
  const left = budget.budget?.remainingCredits ?? 0;
  if (card.credits > left) return { kind: 'over-budget', needed: card.credits, left };
  return { kind: 'ready' };
}
