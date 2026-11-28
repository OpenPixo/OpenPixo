/**
 * Input-method composition (pinyin, kana, Hangul, ...): the Enter that picks a
 * candidate is a keydown like any other, and must not submit, save or rename.
 *
 * Every Enter-to-submit handler on a text field asks `isSubmitEnter` instead of
 * comparing `event.key` alone. Safari ends the composition before the keydown
 * arrives, so `isComposing` is already false there; that keydown still carries
 * keyCode 229, which is why both are read.
 */

interface CompositionKeyFields {
  isComposing?: boolean;
  keyCode?: number;
}

/** A DOM `KeyboardEvent`, or a React keyboard event with its `nativeEvent`. */
export interface ImeKeyEvent extends CompositionKeyFields {
  key?: string;
  nativeEvent?: CompositionKeyFields;
}

export function isImeComposing(event: ImeKeyEvent): boolean {
  const native = event.nativeEvent ?? event;
  return Boolean(native.isComposing || event.isComposing)
    || native.keyCode === 229
    || event.keyCode === 229;
}

/** A plain Enter keydown that is not confirming an input-method candidate. */
export function isSubmitEnter(event: ImeKeyEvent): boolean {
  return event.key === 'Enter' && !isImeComposing(event);
}
