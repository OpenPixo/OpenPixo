// @vitest-environment jsdom
/**
 * A cell whose content is still on its way must not be a still grey block. Two places:
 * the cells of a generation row that have not come back, and an artifact card still
 * being written. jsdom has no layout, so this pins where the glow is mounted, not how it looks.
 */
import { PRODUCT_CLI_NAME, type PersistedAgentEvent } from '@openpixo/contracts';
import { cleanup, render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecutionShell } from '../../../src/components/chat/ExecutionShell';
import { ArtifactCards } from '../../../src/components/FileOpsSummary';
import { I18nProvider } from '../../../src/i18n';
import { buildTurnBlocks } from '../../../src/runtime/chat/build-turn-blocks';
import type { ExecutionShell as ShellData } from '../../../src/runtime/chat/contract';

const GLOW = '[data-testid="generating-glow"]';
const render = (ui: ReactElement) => rtlRender(<I18nProvider initial="zh-CN">{ui}</I18nProvider>);
const generated = (path: string) => JSON.stringify({ status: 'succeeded', path });
const failed = () => JSON.stringify({ status: 'failed', error: { code: 'provider_missing' } });

/** Four asked for: one done, one failed, two still to come. */
function partiallyGeneratedShell(): ShellData {
  const events: PersistedAgentEvent[] = [
    {
      kind: 'tool_use',
      id: 'g1',
      name: 'Bash',
      input: { command: `${PRODUCT_CLI_NAME} media generate a && ${PRODUCT_CLI_NAME} media generate b && ${PRODUCT_CLI_NAME} media generate c && ${PRODUCT_CLI_NAME} media generate d` },
      startedAt: 0,
    },
    { kind: 'tool_result', toolUseId: 'g1', content: [generated('a.png'), failed()].join('\n'), isError: false },
  ];
  const shell = buildTurnBlocks({ events, runStatus: 'running' }).find((block): block is ShellData => block.kind === 'shell');
  if (!shell) throw new Error('no execution shell');
  return shell;
}

afterEach(cleanup);

describe('generation row', () => {
  it('glows only in the cells still to come', () => {
    const { container } = render(<ExecutionShell shell={partiallyGeneratedShell()} />);
    const cells = [...container.querySelectorAll('[data-image-cell]')];
    expect(cells.length).toBe(4);
    expect(cells.filter((cell) => cell.querySelector(GLOW)).map((cell) => cell.getAttribute('data-image-cell'))).toEqual(['loading', 'loading']);
  });

  it('is decoration for a screen reader, which gets a status line instead', () => {
    const { container } = render(<ExecutionShell shell={partiallyGeneratedShell()} />);
    expect(container.querySelector(GLOW)?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getAllByRole('status').some((node) => node.textContent === '配图生成中')).toBe(true);
  });
});

describe('artifact card', () => {
  it('glows while the file is being written', () => {
    const { container } = render(<ArtifactCards items={[{ name: 'poster.png', kind: 'image', pending: true }]} projectId="p1" />);
    expect(container.querySelector(GLOW)).not.toBeNull();
  });

  it('does not glow for a document, which simply has no preview, or for a finished image', () => {
    const doc = render(<ArtifactCards items={[{ name: 'notes.md', kind: 'doc' }]} projectId="p1" />);
    expect(doc.container.querySelector(GLOW)).toBeNull();
    doc.unmount();
    const done = render(<ArtifactCards items={[{ name: 'poster.png', kind: 'image' }]} projectId="p1" />);
    expect(done.container.querySelector(GLOW)).toBeNull();
  });
});
