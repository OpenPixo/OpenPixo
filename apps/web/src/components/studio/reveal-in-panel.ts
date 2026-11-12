/**
 * Scrolls `element` into view inside its nearest scrolling ancestor only.
 * `Element.scrollIntoView` also scrolls every outer container, which in the
 * project workspace shifts the whole shell and hides its tab bar.
 */
export function revealInPanel(element: HTMLElement | null, margin = 12): void {
  if (!element) return;
  let parent = element.parentElement;
  while (parent) {
    const overflow = getComputedStyle(parent).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && parent.scrollHeight > parent.clientHeight) break;
    parent = parent.parentElement;
  }
  if (!parent) return;
  const box = parent.getBoundingClientRect();
  const target = element.getBoundingClientRect();
  if (target.top >= box.top && target.top < box.bottom - 48) return;
  parent.scrollTo?.({ top: parent.scrollTop + target.top - box.top - margin, behavior: 'smooth' });
}
