import { describe, expect, it, vi } from 'vitest';
import { resolveSystemProxyEnvAsync } from '../src/proxy-env.js';

describe('asynchronous system proxy discovery', () => {
  it('starts independent Windows registry probes together and preserves proxy settings', async () => {
    const release = new Map<string, (output: string) => void>();
    const runCommand = vi.fn((_command: string, args: string[]) => new Promise<string>((resolve) => {
      release.set(args.at(-1)!, resolve);
    }));
    const pending = resolveSystemProxyEnvAsync({ platform: 'win32', runCommand });
    expect(runCommand).toHaveBeenCalledTimes(3);
    release.get('ProxyEnable')!('    ProxyEnable    REG_DWORD    0x1\n');
    release.get('ProxyOverride')!('    ProxyOverride    REG_SZ    <local>\n');
    release.get('ProxyServer')!('    ProxyServer    REG_SZ    http=127.0.0.1:8001;https=127.0.0.1:8002\n');
    await expect(pending).resolves.toMatchObject({
      HTTP_PROXY: 'http://127.0.0.1:8001',
      HTTPS_PROXY: 'http://127.0.0.1:8002',
      NODE_USE_ENV_PROXY: '1',
    });
  });

  it('ignores unavailable platform commands and unsupported platforms', async () => {
    const runCommand = vi.fn(async () => { throw new Error('unavailable'); });
    await expect(resolveSystemProxyEnvAsync({ platform: 'darwin', runCommand })).resolves.toEqual({});
    await expect(resolveSystemProxyEnvAsync({ platform: 'linux', runCommand })).resolves.toEqual({});
    expect(runCommand).toHaveBeenCalledTimes(1);
  });
});
