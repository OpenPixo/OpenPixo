// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectExtensionSummary, ProjectExtensionsResponse } from '@openpixo/contracts';
import { ProjectExtensionsPanel } from '../src/components/ProjectExtensionsPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function extension(overrides: Partial<ProjectExtensionSummary> = {}): ProjectExtensionSummary {
  return { id: 'image-batch', name: 'Image batch', description: 'Process selected images.',
    enabled: true, version: 'sha256:abc', source: 'C:\\skills\\image-batch', managed: true, available: true,
    ...overrides };
}

function listing(skills: ProjectExtensionSummary[] = []): ProjectExtensionsResponse {
  return { skills, mcpServers: [], catalog: { skills: [{ id: 'image-batch', name: 'Image batch', description: 'Images' }],
    mcpServers: [], mcpTemplates: [] } };
}

function response(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe('ProjectExtensionsPanel', () => {
  it('refreshes a pinned catalog extension only through an explicit update action', async () => {
    const pinned = extension({ source: 'catalog:image-batch', version: 'sha256:old' });
    const fetchMock = vi.fn().mockResolvedValueOnce(response(listing([pinned])))
      .mockResolvedValueOnce(response(listing([{ ...pinned, version: 'sha256:new' }])));
    vi.stubGlobal('fetch', fetchMock);
    render(<ProjectExtensionsPanel projectId="game" locale="en" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Update Image batch' }));
    expect(await screen.findByText('sha256:new')).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/projects/game/extensions/skill/image-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update' }),
    });
  });

  it('waits for the project mutation before changing enabled state and removes through the same project API', async () => {
    const changed = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(listing([extension()])))
      .mockReturnValueOnce(changed.promise)
      .mockResolvedValueOnce(response(listing()));
    vi.stubGlobal('fetch', fetchMock);
    render(<ProjectExtensionsPanel projectId="project-a" locale="en" />);

    const disable = await screen.findByRole('button', { name: 'Disable Image batch' });
    fireEvent.click(disable);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/projects/project-a/extensions/skill/image-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disable' }),
    });
    expect(disable.getAttribute('aria-pressed')).toBe('true');
    expect((disable as HTMLButtonElement).disabled).toBe(true);

    changed.resolve(response(listing([extension({ enabled: false })])));
    const enable = await screen.findByRole('button', { name: 'Enable Image batch' });
    expect(enable.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Image batch' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enable Image batch' })).toBeNull());
    expect(fetchMock).toHaveBeenLastCalledWith('/api/projects/project-a/extensions/skill/image-batch', { method: 'DELETE' });
  });

  it('keeps source input and installed extensions when an import is rejected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(listing([extension()])))
      .mockResolvedValueOnce(response({ error: { code: 'BAD_REQUEST', message: 'Skill folder contains a symbolic link.' } }, 400));
    vi.stubGlobal('fetch', fetchMock);
    render(<ProjectExtensionsPanel projectId="game" locale="zh-CN" />);

    fireEvent.click(await screen.findByRole('button', { name: '添加技能或 MCP 服务器' }));
    const source = screen.getByRole('textbox', { name: '本地路径或 GitHub 地址' });
    fireEvent.change(source, { target: { value: 'C:\\skills\\unsafe' } });
    fireEvent.click(screen.getByRole('button', { name: '导入到项目' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Skill folder contains a symbolic link.');
    expect((source as HTMLInputElement).value).toBe('C:\\skills\\unsafe');
    expect(screen.getByRole('button', { name: '停用 Image batch' })).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/projects/game/extensions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'skill', source: 'C:\\skills\\unsafe' }),
    });
  });

  it('does not show a previous project response after switching projects', async () => {
    const previous = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(previous.promise)
      .mockResolvedValueOnce(response(listing([extension({ id: 'audio', name: 'Audio trim' })])));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<ProjectExtensionsPanel projectId="old" locale="en" />);
    view.rerender(<ProjectExtensionsPanel projectId="new" locale="en" />);
    expect(await screen.findByRole('button', { name: 'Disable Audio trim' })).toBeTruthy();
    await act(async () => { previous.resolve(response(listing([extension()]))); });
    expect(screen.queryByRole('button', { name: 'Disable Image batch' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Disable Audio trim' })).toBeTruthy();
  });

  it('configures an MCP template without executing it and rejects malformed JSON before import', async () => {
    const data = listing();
    data.catalog.mcpTemplates = [{ id: 'local-tools', label: 'Local tools', description: 'Local utility MCP',
      transport: 'stdio', category: 'utilities', command: 'node', args: ['server.mjs'] }];
    const server = { id: 'local-tools', templateId: 'local-tools', label: 'Local tools', transport: 'stdio', enabled: true, command: 'node', args: ['server.mjs'] };
    const installed = listing();
    installed.mcpServers = [extension({ id: 'local-tools', name: 'Local tools', source: 'inline',
      dependency: { status: 'missing', message: 'Install Node.js to run this MCP server.' } })];
    const fetchMock = vi.fn().mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response(installed));
    vi.stubGlobal('fetch', fetchMock);
    render(<ProjectExtensionsPanel projectId="game" locale="en" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a skill or MCP server' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'mcp' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Add from catalog' }), { target: { value: 'template:local-tools' } });
    fireEvent.click(screen.getByRole('button', { name: 'Configure template' }));
    const editor = screen.getByRole('textbox', { name: 'MCP server JSON (optional)' });
    expect(JSON.parse((editor as HTMLTextAreaElement).value)).toEqual(server);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(editor, { target: { value: '{broken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import to project' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Enter a JSON object for the MCP server.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(editor, { target: { value: JSON.stringify(server) } });
    fireEvent.click(screen.getByRole('button', { name: 'Import to project' }));
    const mcpSection = await screen.findByRole('region', { name: 'MCP servers' });
    await waitFor(() => expect(within(mcpSection).getByText('Install Node.js to run this MCP server.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Update Local tools' })).toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/projects/game/extensions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'mcp', server }),
    });
  });

  it('preserves template identity and required configuration with a safe documentation link', async () => {
    const data = listing();
    data.catalog.mcpTemplates = [
      { id: 'asset-service', label: 'Asset service', description: 'Remote assets', transport: 'http', category: 'utilities',
        url: 'https://assets.example/mcp', homepage: 'https://assets.example/docs',
        envFields: [{ key: 'ASSET_API_KEY', required: true }, { key: 'ASSET_REGION' }],
        headerFields: [{ key: 'Authorization', required: true }] },
      { id: 'unsafe-homepage', label: 'Untrusted homepage', description: '', transport: 'http', category: 'utilities',
        url: 'https://assets.example/mcp', homepage: 'javascript:alert(1)' },
    ];
    const fetchMock = vi.fn().mockResolvedValue(response(data));
    vi.stubGlobal('fetch', fetchMock);
    render(<ProjectExtensionsPanel projectId="game" locale="en" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a skill or MCP server' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), { target: { value: 'mcp' } });
    const catalog = screen.getByRole('combobox', { name: 'Add from catalog' });
    fireEvent.change(catalog, { target: { value: 'template:asset-service' } });
    expect(screen.getByText('ASSET_API_KEY, Authorization')).toBeTruthy();
    const docs = screen.getByRole('link', { name: 'Server documentation' });
    expect(docs.getAttribute('href')).toBe('https://assets.example/docs');
    expect(docs.getAttribute('rel')).toContain('noopener');
    fireEvent.click(screen.getByRole('button', { name: 'Configure template' }));
    const editor = screen.getByRole('textbox', { name: 'MCP server JSON (optional)' }) as HTMLTextAreaElement;
    expect(JSON.parse(editor.value)).toEqual({ id: 'asset-service', templateId: 'asset-service',
      label: 'Asset service', transport: 'http', enabled: true, url: 'https://assets.example/mcp',
      env: { ASSET_API_KEY: '', ASSET_REGION: '' }, headers: { Authorization: '' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(catalog, { target: { value: 'template:unsafe-homepage' } });
    expect(screen.queryByRole('link', { name: 'Server documentation' })).toBeNull();
  });

  it('lists built-in skills first, explains one on click, and keeps the add forms folded away', async () => {
    const data = listing();
    data.defaultSkills = [
      { id: 'phaser-game-dev', name: 'Phaser 3 game development craft', description: 'Write Phaser 3 code that follows the rules.' },
      { id: 'game-feel-juice', name: 'Game feel', description: 'Add screen shake and hit-stop.' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)));
    const opened = vi.fn();
    window.addEventListener('openpixo:open-skills-settings', opened);
    render(<ProjectExtensionsPanel projectId="game" locale="en" />);

    const defaults = await screen.findByTestId('project-default-skills');
    expect(within(defaults).getByRole('heading').textContent).toBe('Built-in skills · 2');
    expect(screen.queryByText('Added to this project')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Local path or GitHub URL' })).toBeNull();

    fireEvent.click(within(defaults).getByRole('button', { name: 'Game feel' }));
    expect(within(defaults).getByRole('status').textContent).toContain('Add screen shake and hit-stop.');

    fireEvent.click(within(defaults).getByRole('button', { name: 'Turn skills on or off' }));
    expect(opened).toHaveBeenCalledTimes(1);
    window.removeEventListener('openpixo:open-skills-settings', opened);

    fireEvent.click(screen.getByRole('button', { name: 'Add a skill or MCP server' }));
    expect(screen.getByRole('textbox', { name: 'Local path or GitHub URL' })).toBeTruthy();
  });
});
