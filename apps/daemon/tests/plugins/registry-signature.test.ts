import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resolveRegistryConfiguration, verifyRegistrySignature } from '../../src/plugins/registry-signature.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const keys = { test: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
const bytes = Buffer.from('{"name":"catalog","label":"ゲーム"}\r\n');
const signature = JSON.stringify({ alg: 'ed25519', keyId: 'test', signature: sign(null, bytes, privateKey).toString('base64') });

describe('registry signatures', () => {
  it('verifies exact raw bytes using base64 SPKI keys', () => {
    expect(verifyRegistrySignature(bytes, signature, keys)).toBe(true);
    expect(verifyRegistrySignature(Buffer.from(bytes.toString().replace('\r\n', '\n')), signature, keys)).toBe(false);
    expect(verifyRegistrySignature(bytes, signature, {})).toBe(false);
    const otherKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    expect(verifyRegistrySignature(bytes, signature, { test: otherKey })).toBe(false);
  });

  it.each([undefined, null, '', '{}', 'not json', '{"alg":"rsa","keyId":"test","signature":"AA=="}'])(
    'rejects missing or malformed signatures: %s', envelope => {
      expect(verifyRegistrySignature(bytes, envelope, keys)).toBe(false);
    },
  );

  it('resolves only the OpenPixo config and its daemon overrides', () => {
    expect(resolveRegistryConfiguration({})).toEqual({ url: null, publicKeys: {} });
    expect(resolveRegistryConfiguration({ PIXO_REGISTRY_URL: 'https://registry.example/', PIXO_REGISTRY_PUBLIC_KEYS: JSON.stringify(keys) }))
      .toEqual({ url: 'https://registry.example', publicKeys: keys });
    expect(() => resolveRegistryConfiguration({ PIXO_REGISTRY_PUBLIC_KEYS: '[]' })).toThrow(/JSON object/);
    expect(() => resolveRegistryConfiguration({ PIXO_REGISTRY_URL: 'http://registry.example' })).toThrow(/https/);
  });
});
