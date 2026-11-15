// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OPENPIXO_HOST_GLOBAL } from '@openpixo/host';
import { createMockOpenPixoHost } from '@openpixo/host/testing';
import {
  attachProjectFilesToChat,
  projectFileMenuEntries,
  type ProjectFileMenuInput,
} from '../../src/components/context-menu/file-actions';
import type { ContextMenuEntry } from '../../src/components/context-menu/ContextMenu';
import { STAGE_ATTACHMENT_EVENT } from '../../src/runtime/chat/project-file-reference';

const t = ((key: string) => key) as ProjectFileMenuInput['t'];

function ids(entries: ContextMenuEntry[]): string[] {
  return entries.map((entry) => (entry.kind === 'submenu'
    ? `${entry.id}[${entry.items.map((item) => item.id).join(',')}]`
    : entry.id));
}

function input(extra: Partial<ProjectFileMenuInput> = {}): ProjectFileMenuInput {
  return {
    projectId: 'game',
    path: 'art/hero.png',
    url: '/api/projects/game/raw/art/hero.png',
    image: true,
    onOpen: vi.fn(),
    t,
    notify: vi.fn(),
    ...extra,
  };
}

const scope = globalThis as unknown as Record<string, unknown>;

beforeEach(() => { delete scope[OPENPIXO_HOST_GLOBAL]; });
afterEach(() => { delete scope[OPENPIXO_HOST_GLOBAL]; vi.restoreAllMocks(); });

describe('projectFileMenuEntries', () => {
  it('gives an image open, copy image, save, attach and copy in the browser', () => {
    expect(ids(projectFileMenuEntries(input()))).toEqual([
      'open', 'sep-open', 'copy-image', 'save', 'sep-save', 'attach', 'copy[copy-name,copy-relative-path]',
    ]);
  });

  it('adds Show in Explorer only inside the desktop app', async () => {
    const showItemInFolder = vi.fn(async () => ({ ok: true as const }));
    scope[OPENPIXO_HOST_GLOBAL] = createMockOpenPixoHost({
      client: { type: 'desktop', platform: 'win32' },
      shell: { openExternal: vi.fn(), openPath: vi.fn(), showItemInFolder },
    });
    const entries = projectFileMenuEntries(input({ absolutePath: 'C:\\games\\hero\\art\\hero.png' }));
    expect(ids(entries).slice(-3)).toEqual(['copy[copy-name,copy-relative-path,copy-absolute-path]', 'sep-reveal', 'reveal']);
    const reveal = entries.at(-1);
    expect(reveal && 'label' in reveal ? reveal.label : null).toBe('contextMenu.showInExplorer');
    if (reveal && reveal.kind !== 'separator' && reveal.kind !== 'submenu') reveal.onSelect();
    await vi.waitFor(() => expect(showItemInFolder).toHaveBeenCalledWith('game', 'art/hero.png'));
  });

  it('offers a non-image file a save but no copy image', () => {
    expect(ids(projectFileMenuEntries(input({ path: 'src/main.gd', image: false })))).not.toContain('copy-image');
  });

  it('leaves a deleted file only its name and path', () => {
    expect(ids(projectFileMenuEntries(input({ deleted: true })))).toEqual(['copy[copy-name,copy-relative-path]']);
  });

  it('keeps read-only viewers out of the chat', () => {
    expect(ids(projectFileMenuEntries(input({ canAttach: false })))).not.toContain('attach');
  });
});

describe('attachProjectFilesToChat', () => {
  it('stages the file as a chat reference and reports whether a composer took it', () => {
    expect(attachProjectFilesToChat([{ path: 'art/hero.png' }])).toBe(false);
    const take = (event: Event) => event.preventDefault();
    const seen: unknown[] = [];
    const record = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(STAGE_ATTACHMENT_EVENT, take);
    window.addEventListener(STAGE_ATTACHMENT_EVENT, record);
    try {
      expect(attachProjectFilesToChat([{ path: 'art/hero.png', size: 12 }])).toBe(true);
      expect(seen.at(-1)).toEqual({ attachments: [{ path: 'art/hero.png', name: 'hero.png', kind: 'image', size: 12 }] });
    } finally {
      window.removeEventListener(STAGE_ATTACHMENT_EVENT, take);
      window.removeEventListener(STAGE_ATTACHMENT_EVENT, record);
    }
  });
});
