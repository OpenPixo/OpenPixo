/** The project's style reference path (`metadata.styleReference`), or null; the file is not checked here. */
export function projectStyleReference(metadata: { styleReference?: unknown } | null | undefined): string | null {
  return typeof metadata?.styleReference === 'string' && metadata.styleReference ? metadata.styleReference : null;
}
