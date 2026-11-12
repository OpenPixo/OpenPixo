import { afterEach, describe, expect, it, vi } from 'vitest';
import { runProjectCheckpointCli } from '../../src/projects/checkpoints-cli.js';

const previousExitCode = process.exitCode;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); process.exitCode = previousExitCode; });

describe('pixo project checkpoint', () => {
  it.each([
    { args: ['list', 'game'], path: '', method: 'GET' },
    { args: ['show', 'game', 'snapshot-1'], path: '/snapshot-1', method: 'GET' },
    { args: ['restore', 'game', 'snapshot-1', '--yes'], path: '/snapshot-1/restore', method: 'POST' },
    { args: ['enable', '--project', 'game', '--yes'], path: '/enable', method: 'POST' },
  ])('routes $args to the shared HTTP API with JSON output', async ({ args, path, method }) => {
    const result = { status: 'available', checkpoints: [], busy: false };
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify(result), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runProjectCheckpointCli([...args, '--json', '--daemon-url', 'http://127.0.0.1:19342']);
    expect(fetcher).toHaveBeenCalledWith(`http://127.0.0.1:19342/api/projects/game/checkpoints${path}`, expect.objectContaining({ method }));
    if (method === 'POST') expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ body: JSON.stringify({ confirmed: true }) });
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual(result);
  });

  it('requires explicit confirmation before enabling or restoring', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runProjectCheckpointCli(['enable', 'game', '--json']);
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.parse(String(output.mock.calls[0]?.[0])).error.code).toBe('CHECKPOINT_CONFIRM_REQUIRED');
    expect(process.exitCode).toBe(1);
  });
});

it('forwards an agent token to the same checkpoint API', async () => {
  vi.stubEnv('PIXO_TOOL_TOKEN', 'pixott_checkpoint');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'available', checkpoints: [] })));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await runProjectCheckpointCli(['list', 'game', '--json', '--daemon-url', 'http://127.0.0.1:19342']);
  expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer pixott_checkpoint' }) }));
});

describe('pixo project checkpoint diff / file', () => {
  const fileDiff = { checkpointId: 'snapshot-1', target: 'run_end', path: 'scripts/player.gd', status: 'modified', binary: false, truncated: false,
    additions: 1, deletions: 1, hunks: [{ header: '@@ -1,2 +1,2 @@', lines: [{ kind: 'context', text: 'var a = 1' }, { kind: 'del', text: 'var b = 2' }, { kind: 'add', text: 'var b = 3' }] }] };

  it('calls the diff endpoint with the path and prints the same JSON payload', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => Response.json(fileDiff));
    vi.stubGlobal('fetch', fetcher);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runProjectCheckpointCli(['diff', 'game', 'snapshot-1', '--path', 'scripts/player.gd', '--json', '--daemon-url', 'http://127.0.0.1:19342']);
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:19342/api/projects/game/checkpoints/snapshot-1/diff?path=scripts%2Fplayer.gd', expect.objectContaining({ method: 'GET' }));
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual(fileDiff);
  });

  it('prints unified diff text without --json', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ checkpointId: 'snapshot-1', target: 'working_tree', truncated: false,
      files: [fileDiff, { path: 'art/hero.png', status: 'added', binary: true, truncated: false, additions: null, deletions: null, hunks: [] }] })));
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runProjectCheckpointCli(['diff', 'game', 'snapshot-1', '--daemon-url', 'http://127.0.0.1:19342']);
    const text = String(output.mock.calls[0]?.[0]);
    expect(text).toContain('# Compared with the current files');
    expect(text).toContain('--- a/scripts/player.gd\n+++ b/scripts/player.gd\n@@ -1,2 +1,2 @@\n var a = 1\n-var b = 2\n+var b = 3\n');
    expect(text).toContain('--- /dev/null\n+++ b/art/hero.png\nBinary file changed');
  });

  it('writes one side of a file to --out', async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runProjectCheckpointCli(['file', 'game', 'snapshot-1', '--path', 'art/hero.png', '--side', 'before', '--out', '-', '--daemon-url', 'http://127.0.0.1:19342']);
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:19342/api/projects/game/checkpoints/snapshot-1/file?path=art%2Fhero.png&side=before', expect.anything());
    expect(Buffer.from(output.mock.calls[0]?.[0] as Uint8Array)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('refuses file without a side', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runProjectCheckpointCli(['file', 'game', 'snapshot-1', '--path', 'a.png', '--out', '-', '--json']);
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.parse(String(output.mock.calls[0]?.[0])).error.code).toBe('CHECKPOINT_PATH_INVALID');
    expect(process.exitCode).toBe(1);
  });
});
