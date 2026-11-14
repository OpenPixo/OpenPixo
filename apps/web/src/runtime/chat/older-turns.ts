/**
 * Which part of a long conversation the chat draws.
 *
 * A long transcript keeps only its latest turns on screen and folds the rest
 * behind "show earlier". A turn starts at a user message, so the fold never
 * cuts a reply off from the message it answers. The body, the message rail and
 * the pin-to-top all read the same visible slice, so a rail dot never points at
 * a message that is not drawn.
 */

/** Turns shown when a conversation opens. */
export const CHAT_INITIAL_VISIBLE_TURNS = 10;
/** Turns each "show earlier" click adds. */
export const CHAT_REVEAL_TURNS_STEP = 10;

export interface OlderTurnsWindow<T> {
  /** The items to draw, in order. */
  visible: T[];
  /** User turns folded above `visible`; 0 when nothing is folded. */
  hiddenTurns: number;
}

/**
 * Keeps the latest `turns` user turns. Anything before the first kept user
 * message is folded. `Infinity` (or a count at or above the number of turns)
 * keeps everything.
 */
export function olderTurnsWindow<T extends { message: { role: string } }>(
  items: readonly T[],
  turns: number,
): OlderTurnsWindow<T> {
  let seen = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]!.message.role !== 'user') continue;
    seen += 1;
    if (seen < turns) continue;
    let hiddenTurns = 0;
    for (let before = 0; before < index; before += 1) {
      if (items[before]!.message.role === 'user') hiddenTurns += 1;
    }
    // Only a whole earlier turn is worth a fold; a lone greeting before the
    // first user message stays.
    if (hiddenTurns === 0) break;
    return { visible: items.slice(index), hiddenTurns };
  }
  return { visible: items as T[], hiddenTurns: 0 };
}
