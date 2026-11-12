// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectExtensionsResponse } from '@openpixo/contracts';
import { ProjectExtensionsPanel } from '../../src/components/ProjectExtensionsPanel';

const entry = {
  id: 'sprites', name: 'Sprite workflow', description: 'Preserve sprite scale.',
  enabled: true, available: true, managed: true, source: 'catalog:sprites', version: '1',
  contextCost: { indexBytes: 200, indexTokens: 50, onDemandBytes: 8000, onDemandTokens: 2000 },
};
const payload: ProjectExtensionsResponse = {
  skills: [entry], mcpServers: [], catalog: { skills: [], mcpServers: [], mcpTemplates: [] },
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('project skill context cost', () => {
  it.each([
    ['en', 'Always-on index (estimate)', 'On-demand workflow (estimate)', '≈ 50 tokens · 200 bytes', '≈ 2,000 tokens · 8,000 bytes'],
    ['zh-CN', '常驻索引（估算）', '按需正文（估算）', '约 50 tokens · 200 字节', '约 2,000 tokens · 8,000 字节'],
  ])('shows the enabled skill index and workflow sizes in %s', async (locale, index, demand, indexValue, demandValue) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload })));
    render(<ProjectExtensionsPanel projectId="game" locale={locale!} />);
    expect(await screen.findByText(index!)).toBeTruthy();
    expect(screen.getByText(demand!)).toBeTruthy();
    expect(screen.getByText(indexValue!)).toBeTruthy();
    expect(screen.getByText(demandValue!)).toBeTruthy();
  });

  it('does not count a disabled skill as always on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ...payload, skills: [{ ...entry, enabled: false }] }) })));
    render(<ProjectExtensionsPanel projectId="game" locale="en" />);
    await screen.findByText(entry.name);
    expect(screen.queryByText('Always-on index (estimate)')).toBeNull();
  });

  it('localizes backend failures for the Chinese panel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Unexpected English backend failure' }) })));
    render(<ProjectExtensionsPanel projectId="game" locale="zh-CN" />);
    expect((await screen.findByRole('alert')).textContent).toBe('无法加载项目扩展。');
  });
});
