// Historical conversation markup cleanup; no critique runtime or protocol producer remains.
export const CRITIQUE_INLINE_TAGS = ['PANELIST', 'MUST_FIX', 'RESOLVED', 'SHIP'] as const;

export const CRITIQUE_BLOCK_TAGS = ['CRITIQUE_RUN', 'ROUND', 'ROUND_END'] as const;

export const CRITIQUE_GRAMMAR_TAGS: readonly string[] = [
  ...CRITIQUE_INLINE_TAGS,
  ...CRITIQUE_BLOCK_TAGS,
];

export function critiqueGrammarTagPattern(): RegExp {
  return new RegExp(`</?(?:${CRITIQUE_GRAMMAR_TAGS.join('|')})(?=[\\s/>])[^>]*>`, 'g');
}

export function stripCritiqueGrammar(text: string): string {
  if (!text || !text.includes('<')) return text;
  const withoutTags = text.replace(critiqueGrammarTagPattern(), '');
  if (withoutTags === text) return text;
  return withoutTags.replace(/\n{3,}/g, '\n\n');
}
