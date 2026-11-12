import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAssetCli } from '../src/assets/asset-cli.js';
import { parseImageEditCli } from '../src/assets/image-edit-cli.js';

vi.mock('../src/daemon-url.js', () => ({ resolveDaemonUrl: vi.fn(async ({ flagUrl }: { flagUrl: string | null }) => flagUrl ?? 'http://127.0.0.1:7456') }));

let previousExitCode: typeof process.exitCode;
beforeEach(() => {
  previousExitCode = process.exitCode;
  process.exitCode = 0;
});
afterEach(() => {
  process.exitCode = previousExitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('asset edit CLI mapping', () => {
  it('preserves operation flag order and repeated operations, with nearest applied to every resize', () => {
    const parsed = parseImageEditCli(['project', 'sprites/hero.png', '--flip', 'v', '--crop', '1,2,3,4', '--resize', '8x12', '--trim', '--pad', 'pot', '--flip', 'h', '--rotate', '90', '--resize', '50%', '--nearest', '--out', 'hero_edit.png', '--json']);
    expect(parsed).toEqual({
      projectId: 'project', json: true, daemonUrl: null,
      request: {
        source: 'sprites/hero.png', output: 'hero_edit.png', ops: [
          { op: 'flip', axis: 'v' }, { op: 'crop', x: 1, y: 2, width: 3, height: 4 },
          { op: 'resize', width: 8, height: 12, filter: 'nearest' }, { op: 'trim' },
          { op: 'pad', powerOfTwo: true }, { op: 'flip', axis: 'h' }, { op: 'rotate', degrees: 90 },
          { op: 'resize', scale: 0.5, filter: 'nearest' },
        ],
      },
    });
  });

  it('supports inline values, smooth fractional percentages, explicit canvas dimensions, and source-adjacent default names', () => {
    expect(parseImageEditCli(['game', 'sprites/hero.idle.png', '--resize=12.5%', '--pad=16X32']).request).toEqual({
      source: 'sprites/hero.idle.png', output: 'hero.idle_pad.png',
      ops: [{ op: 'resize', scale: 0.125, filter: 'smooth' }, { op: 'pad', width: 16, height: 32 }],
    });
    expect(parseImageEditCli(['game', 'sprites\\hero.png', '--trim']).request.output).toBe('hero_trim.png');
  });

  it.each([
    { flags: [], message: 'At least one image operation' },
    { flags: ['--crop', '1,2,3'], message: '--crop requires' },
    { flags: ['--crop', '1,2,0,4'], message: 'positive integers' },
    { flags: ['--crop=-1,2,3,4'], message: '--crop requires' },
    { flags: ['--crop', '1.5,2,3,4'], message: '--crop requires' },
    { flags: ['--resize', '0%'], message: 'percentage must be positive' },
    { flags: ['--resize', '10x0'], message: 'positive integers' },
    { flags: ['--resize', '12'], message: 'requires WxH' },
    { flags: ['--pad', '32x'], message: 'requires WxH' },
    { flags: ['--flip', 'both'], message: '--flip must be h or v' },
    { flags: ['--rotate', '180'], message: '--rotate must be 90' },
    { flags: ['--trim', '--nearest'], message: '--nearest requires --resize' },
    { flags: ['--trim', '--out', ' '], message: 'non-empty output name' },
  ])('rejects invalid operations before a request: $flags', ({ flags, message }) => {
    expect(() => parseImageEditCli(['game', 'hero.png', ...flags])).toThrow(message);
  });

  it('requires exactly one project id and one asset path', () => {
    expect(() => parseImageEditCli(['hero.png', '--trim'])).toThrow('project id and one asset path');
    expect(() => parseImageEditCli(['game', 'hero.png', 'extra.png', '--trim'])).toThrow('project id and one asset path');
  });
});

describe('asset edit CLI HTTP boundary', () => {
  it('dispatches through asset, sends the shared endpoint request with tool authentication, and prints the returned asset as JSON', async () => {
    const asset = { relPath: 'sprites/hero_crop.png', kind: 'image', size: 72, origin: 'processed' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(asset), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PIXO_TOOL_TOKEN', 'tool-token');
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runAssetCli(['edit', 'game / one', 'sprites/hero.png', '--crop', '0,1,2,3', '--out', 'hero_crop.png', '--daemon-url', 'http://127.0.0.1:23456/', '--json']);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:23456/api/projects/game%20%2F%20one/assets/edit', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:23456', authorization: 'Bearer tool-token' },
      body: JSON.stringify({ source: 'sprites/hero.png', ops: [{ op: 'crop', x: 0, y: 1, width: 2, height: 3 }], output: 'hero_crop.png' }),
    });
    expect(JSON.parse(stdout.mock.calls.map(call => String(call[0])).join(''))).toEqual(asset);
    expect(process.exitCode).toBe(0);
  });

  it('reports server errors as machine-readable failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Output already exists' } }), { status: 409 })));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runAssetCli(['edit', 'game', 'hero.png', '--trim', '--json']);
    expect(JSON.parse(stdout.mock.calls.map(call => String(call[0])).join(''))).toEqual({ error: { message: 'Output already exists' } });
    expect(process.exitCode).toBe(1);
  });

  it('prints readable success output and validation errors without contacting the daemon', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ relPath: 'hero_trim.png' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runAssetCli(['edit', 'game', 'hero.png', '--trim']);
    expect(log).toHaveBeenCalledWith('hero.png -> hero_trim.png');
    await runAssetCli(['edit', 'game', 'hero.png', '--flip', 'invalid']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stderr).toHaveBeenCalledWith('--flip must be h or v\n');
    expect(process.exitCode).toBe(1);
  });

  it('advertises edit in asset help and documents ordered operations and the smooth default', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runAssetCli(['--help']);
    expect(log.mock.calls[0]?.[0]).toContain('asset edit <projectId> <path>');
    await runAssetCli(['edit', '--help']);
    expect(log.mock.calls[1]?.[0]).toContain('Operations run in flag order and may be repeated');
    expect(log.mock.calls[1]?.[0]).toContain('default: smooth');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
