import { expect, it } from 'vitest';
import { codexOutputSecrets, redactCodexOutput, createCodexTextRedactor } from '../../src/runtimes/codex-output.js';

it('scrubs credential text without changing native correlation IDs or ordinary flags', () => {
  const secrets = codexOutputSecrets([{ id: 'fixture', enabled: true, transport: 'stdio', command: 'node', env: { DEBUG: '1', CUSTOM_CREDENTIAL: 'native-secret-1' }, headers: { Accept: 'application/json' } }], 'provider-key-1');
  expect(secrets).toEqual(['provider-key-1', 'native-secret-1']);
  expect(redactCodexOutput({ type: 'approval_request', requestId: 'request-native-secret-1', threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', details: { message: 'native-secret-1 provider-key-1 DEBUG=1 application/json' } }, secrets)).toEqual({ type: 'approval_request', requestId: 'request-native-secret-1', threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', details: { message: '[REDACTED] [REDACTED] DEBUG=1 application/json' } });
});

it('preserves decisions and ordinary environment values beside secret display text', () => {
  const secrets = codexOutputSecrets([{ id: 'fixture', enabled: true, transport: 'stdio', command: 'node', env: { MODE: 'accept', NODE_ENV: 'production', GAME_TOKEN: 'synthetic-token' } }]);
  expect(redactCodexOutput({ type: 'approval_request', availableDecisions: ['accept', 'decline', 'cancel'], decision: 'accept', details: { command: 'node build-production.js', message: 'failed synthetic-token' } }, secrets)).toEqual({ type: 'approval_request', availableDecisions: ['accept', 'decline', 'cancel'], decision: 'accept', details: { command: 'node build-production.js', message: 'failed [REDACTED]' } });
});

it('withholds split credentials in raw diagnostic streams', () => {
  const redactor = createCodexTextRedactor(['secret-123']);
  expect(redactor.write('error secret-')).toBe('error ');
  expect(redactor.write('123 failed')).toBe('[REDACTED] failed');
  expect(redactor.flush()).toBe('');
  const overlapping = createCodexTextRedactor(['aba']);
  expect(overlapping.write('aba') + overlapping.flush()).toBe('[REDACTED]');
});

it('scrubs the token body when an Authorization header is echoed without its scheme', () => {
  const secrets = codexOutputSecrets([{ id: 'fixture', enabled: true, transport: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer arbitrary-oauth-token' } }]);
  expect(redactCodexOutput({ message: 'failed arbitrary-oauth-token' }, secrets)).toEqual({ message: 'failed [REDACTED]' });
});
