/** Annotation identity/selector contract shared by URL, srcDoc, and portable comment bridges.
 * Select the same nonempty attribute for both fields; an empty pixo-id must not mask a screen label.
 * Hosts supply their existing attribute escaping function. This module only emits script source.
 */
export const ANNOTATED_SELECTOR_HELPERS = String.raw`
  function annotatedElementIdFor(el){
    var pixoId = el.getAttribute('data-pixo-id');
    if (pixoId) return pixoId;
    var label = el.getAttribute('data-screen-label');
    return label || null;
  }
  function annotatedSelectorFor(el, esc){
    var pixoId = el.getAttribute('data-pixo-id');
    if (pixoId) return '[data-pixo-id="' + esc(pixoId) + '"]';
    var label = el.getAttribute('data-screen-label');
    if (label) return '[data-screen-label="' + esc(label) + '"]';
    return null;
  }
`;
