// Pure helpers behind the New game dialog's location field. They only shape
// what the user sees; the daemon resolves and authorizes the real path.

/** A full path the daemon could accept: drive letter, UNC share or POSIX root. */
export function isAbsoluteFolderPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value) || value.startsWith('/');
}

/**
 * Display-only join of the parent and the folder name, in the parent's own
 * separator style. The daemon's canonical `target` replaces it once known.
 */
export function previewGameTarget(parent: string, name: string): { parent: string; name: string } {
  const separator = parent.includes('\\') || /^[A-Za-z]:/.test(parent) ? '\\' : '/';
  let trimmed = parent;
  // Keep a bare root ("C:\", "/") intact; drop any other trailing separators.
  while (trimmed.length > 1 && /[\\/]$/.test(trimmed) && !/^[A-Za-z]:[\\/]$/.test(trimmed)) {
    trimmed = trimmed.slice(0, -1);
  }
  const prefix = /[\\/]$/.test(trimmed) ? trimmed : trimmed + separator;
  return { parent: prefix, name };
}

/** Split a canonical target into its parent prefix and leaf for display. */
export function splitTarget(target: string): { parent: string; name: string } {
  const index = Math.max(target.lastIndexOf('\\'), target.lastIndexOf('/'));
  return index < 0 ? { parent: '', name: target } : { parent: target.slice(0, index + 1), name: target.slice(index + 1) };
}

/**
 * Expiry (epoch ms) carried in a picker token (`nonce~expISO~signature`).
 * The expiry is not secret; reading it lets the dialog say the confirmation
 * lapsed instead of waiting for the daemon to refuse it. Null when unreadable.
 */
export function pickerTokenExpiry(token: string): number | null {
  const parts = token.split('~');
  if (parts.length !== 3) return null;
  const exp = Date.parse(parts[1]!);
  return Number.isFinite(exp) ? exp : null;
}

/** "Phaser 3 · 2D" → { engine: "Phaser 3", dimension: "2D" }. */
export function splitTemplateName(name: string): { engine: string; dimension: '2D' | '3D' | null } {
  const match = /^(.*?)\s*·\s*([23]D)\s*$/i.exec(name);
  if (!match) return { engine: name, dimension: null };
  return { engine: match[1]!, dimension: match[2]!.toUpperCase() as '2D' | '3D' };
}
