import { createPublicKey, verify } from 'node:crypto';
import { OPENPIXO_REGISTRY } from '@openpixo/contracts';

export interface RegistryConfiguration {
  url: string | null;
  publicKeys: Record<string, string>;
}

export function resolveRegistryConfiguration(env: NodeJS.ProcessEnv = process.env): RegistryConfiguration {
  const url = (env.PIXO_REGISTRY_URL ?? OPENPIXO_REGISTRY.url)?.trim().replace(/\/+$/, '') || null;
  if (url && new URL(url).protocol !== 'https:') throw new Error('PIXO_REGISTRY_URL must use https://');
  const publicKeys: unknown = env.PIXO_REGISTRY_PUBLIC_KEYS === undefined
    ? OPENPIXO_REGISTRY.publicKeys
    : JSON.parse(env.PIXO_REGISTRY_PUBLIC_KEYS);
  if (!publicKeys || typeof publicKeys !== 'object' || Array.isArray(publicKeys) ||
      Object.values(publicKeys).some(key => typeof key !== 'string' || !key.trim())) {
    throw new Error('PIXO_REGISTRY_PUBLIC_KEYS must be a JSON object of keyId to base64 SPKI public key');
  }
  return { url, publicKeys: { ...publicKeys } as Record<string, string> };
}

// Resolve environment overrides once for this daemon process.
export const REGISTRY_CONFIGURATION = resolveRegistryConfiguration();

export function verifyRegistrySignature(
  bytes: Uint8Array,
  signatureText: string | null | undefined,
  publicKeys: Readonly<Record<string, string>> = REGISTRY_CONFIGURATION.publicKeys,
): boolean {
  try {
    const envelope: unknown = JSON.parse(signatureText ?? '');
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return false;
    const { alg, keyId, signature } = envelope as Record<string, unknown>;
    if (alg !== 'ed25519' || typeof keyId !== 'string' || !Object.hasOwn(publicKeys, keyId) ||
        typeof signature !== 'string') return false;
    const signatureBytes = Buffer.from(signature, 'base64');
    const encodedKey = publicKeys[keyId];
    if (signatureBytes.length !== 64 || signatureBytes.toString('base64') !== signature || !encodedKey) return false;
    const keyBytes = Buffer.from(encodedKey, 'base64');
    if (keyBytes.toString('base64') !== encodedKey) return false;
    const publicKey = createPublicKey({ key: keyBytes, format: 'der', type: 'spki' });
    return publicKey.asymmetricKeyType === 'ed25519' && verify(null, bytes, publicKey, signatureBytes);
  } catch {
    return false;
  }
}
