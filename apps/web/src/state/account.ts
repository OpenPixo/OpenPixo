import type { OpenPixoUser } from '@openpixo/contracts';

/**
 * Which start path the user picked in onboarding. This is a local preference
 * only: the signed-in identity, email and credits always come from the
 * daemon's account status (`useOpenPixoAccount`), never from app config.
 */
export interface CloudAccountPreference {
  mode: 'cloud';
}

export interface ByokAccount {
  mode: 'byok';
}

export type AppAccount = CloudAccountPreference | ByokAccount;
export type AccountPath = AppAccount['mode'];

interface AccountConfig {
  account?: AppAccount | { mode?: unknown } | null;
}

export function createByokAccount(): ByokAccount {
  return { mode: 'byok' };
}

export function createCloudAccountPreference(): CloudAccountPreference {
  return { mode: 'cloud' };
}

/**
 * Installations that completed setup before accounts existed remain local.
 * The retired simulated sign-in (`mock-login`) counts as having chosen the
 * account path; it never created a real session, so the app shows it signed out.
 */
export function getAccountPath(config: AccountConfig): AccountPath {
  const mode = config.account?.mode;
  return mode === 'cloud' || mode === 'mock-login' ? 'cloud' : 'byok';
}

export function accountDisplayName(user: Pick<OpenPixoUser, 'displayName' | 'email'>): string {
  const name = user.displayName?.trim();
  if (name) return name;
  return user.email.split('@')[0] || user.email;
}

export function accountInitial(user: Pick<OpenPixoUser, 'displayName' | 'email'>): string {
  return Array.from(accountDisplayName(user))[0]?.toLocaleUpperCase() ?? '?';
}
