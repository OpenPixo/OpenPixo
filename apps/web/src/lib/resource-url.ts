/** Append resource options while preserving an existing query. */
export function appendResourceQuery(path: string, query: string): string {
  if (!query) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${query.replace(/^[?&]+/, '')}`;
}
