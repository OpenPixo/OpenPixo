/** Stable tracking token for question-form IDs and option values. */
export function questionsFormTrackingId(raw: string | null | undefined): string {
  const slug = (raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return slug || 'unknown';
}
