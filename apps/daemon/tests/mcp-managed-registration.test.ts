import { MCP_BOOTSTRAP_CONTRACT } from '@openpixo/sidecar-proto';
import { describe, expect, it } from 'vitest';

import { parseManagedMcpDiscovery } from '../src/mcp-bootstrap.js';
import {
  buildManagedMcpDiscovery,
  isCodexRegistrationOwnedBy,
  managedMcpRegistrationEnv,
} from '../src/mcp-managed-registration.js';

const stamp = { app: 'daemon', channel: 'prerelease', mode: 'headless', namespace: 'release-prerelease', source: 'openpixo-packaged' } as const;
const fakeEndpoint = (s: { app: string; mode: string }) => `/ipc/${s.app}-${s.mode}.sock`;

describe('managed MCP registration', () => {
  it('names every mode of both the daemon and the desktop owner', () => {
    expect(buildManagedMcpDiscovery(stamp, fakeEndpoint)).toEqual({
      daemon: ['/ipc/daemon-runtime.sock', '/ipc/daemon-headless.sock'],
      desktop: ['/ipc/desktop-runtime.sock', '/ipc/desktop-headless.sock'],
    });
  });

  it('adds discovery only for a managed launch, in the shape the MCP process reads', () => {
    const managedArgs = JSON.stringify(['--headless', MCP_BOOTSTRAP_CONTRACT.MANAGED_ARG]);
    const env = managedMcpRegistrationEnv({ PIXO_MCP_BOOTSTRAP_ARGS: managedArgs }, () => stamp);
    expect(Object.keys(env)).toEqual([MCP_BOOTSTRAP_CONTRACT.DISCOVERY_ENV]);
    expect(parseManagedMcpDiscovery({ PIXO_MCP_BOOTSTRAP_ARGS: managedArgs, ...env })).not.toBeNull();

    // Registrations under an older outer are unchanged.
    expect(managedMcpRegistrationEnv({ PIXO_MCP_BOOTSTRAP_ARGS: '["--headless"]' }, () => stamp)).toEqual({});
  });

  it('keeps the plain registration when the daemon is not sidecar-supervised', () => {
    const managedArgs = JSON.stringify(['--headless', MCP_BOOTSTRAP_CONTRACT.MANAGED_ARG]);
    expect(managedMcpRegistrationEnv({ PIXO_MCP_BOOTSTRAP_ARGS: managedArgs }, () => { throw new Error('no stamp'); })).toEqual({});
  });
});

describe('isCodexRegistrationOwnedBy', () => {
  const registrationEnv = (dataDir: string, app: string, managed = true) => ({
    PIXO_DATA_DIR: dataDir,
    PIXO_MCP_BOOTSTRAP_COMMAND: '/usr/bin/open',
    PIXO_MCP_BOOTSTRAP_ARGS: JSON.stringify([
      '-g', '-j', app, '--args', '--headless', ...(managed ? [MCP_BOOTSTRAP_CONTRACT.MANAGED_ARG] : []),
    ]),
  });
  const prereleaseApp = '/Applications/OpenPixo Prerelease.app';
  const prereleaseData = '/Users/me/Library/Application Support/OpenPixo Prerelease/namespaces/release-prerelease/data';
  const current = { env: registrationEnv(prereleaseData, prereleaseApp) };

  it("accepts this install's registration, including one written before the managed contract", () => {
    expect(isCodexRegistrationOwnedBy({ env: registrationEnv(prereleaseData, prereleaseApp) }, current)).toBe(true);
    expect(isCodexRegistrationOwnedBy({ env: registrationEnv(prereleaseData, prereleaseApp, false) }, current)).toBe(true);
  });

  it('rejects a registration from another channel or namespace', () => {
    const stable = registrationEnv('/Users/me/Library/Application Support/OpenPixo/namespaces/release-stable/data', '/Applications/OpenPixo.app');
    expect(isCodexRegistrationOwnedBy({ env: stable }, current)).toBe(false);
  });

  it('rejects an installed registration when a local build starts, whatever its namespace', () => {
    // The QA case: a temporary managed build must not take over the installed app's registration.
    const qaBuild = { env: registrationEnv('/tmp/qa/runtime/mac/namespaces/qa/data', '/tmp/qa/OpenPixo Prerelease.app') };
    expect(isCodexRegistrationOwnedBy({ env: registrationEnv(prereleaseData, prereleaseApp) }, qaBuild)).toBe(false);
    const sameNamespaceCopy = { env: registrationEnv(prereleaseData, '/tmp/qa/OpenPixo Prerelease.app') };
    expect(isCodexRegistrationOwnedBy({ env: registrationEnv(prereleaseData, prereleaseApp) }, sameNamespaceCopy)).toBe(false);
  });

  it('rejects registrations without a packaged bootstrap', () => {
    expect(isCodexRegistrationOwnedBy({ env: { PIXO_DATA_DIR: prereleaseData } }, current)).toBe(false);
    expect(isCodexRegistrationOwnedBy({ env: registrationEnv(prereleaseData, prereleaseApp) }, { env: { PIXO_DATA_DIR: prereleaseData } })).toBe(false);
  });
});
