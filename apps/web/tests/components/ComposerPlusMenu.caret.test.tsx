// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComposerPlusMenu } from '../../src/components/ComposerPlusMenu';
import type {
  InstalledPluginRecord,
  McpServerConfig,
} from '@openpixo/contracts';

const PLUGIN: InstalledPluginRecord = {
  id: 'sample-plugin',
  title: 'Sample Plugin',
  version: '1.0.0',
  trust: 'restricted',
  sourceKind: 'bundled',
  source: 'bundled/sample',
  capabilitiesGranted: [],
  manifest: {
    name: 'sample-plugin',
    version: '1.0.0',
    title: 'Sample Plugin',
    description: 'Sample',
    pixo: { kind: 'skill' },
  },
  fsPath: '/plugins/sample',
  installedAt: 0,
  updatedAt: 0,
};

const MCP_SERVER: McpServerConfig = {
  id: 'slack',
  label: 'Slack MCP',
  transport: 'stdio',
  enabled: true,
  command: 'slack-mcp',
};

function renderMenu() {
  return render(
    <ComposerPlusMenu
      plugins={[PLUGIN]}
      onPickPlugin={vi.fn()}
      mcpServers={[MCP_SERVER]}
      onPickMcp={vi.fn()}
      onAttachFiles={vi.fn()}
    />,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Add context' }));
}

function openSubmenu(label: string) {
  const parent = Array.from(
    document.querySelectorAll<HTMLButtonElement>('button.plus-menu__parent'),
  ).find((btn) => btn.textContent?.includes(label));
  expect(parent).toBeTruthy();
  fireEvent.click(parent!);
}

function pickerRow(text: string): HTMLButtonElement {
  const row = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.plus-menu__flyout button.plus-menu__item'),
  ).find((btn) => btn.textContent?.includes(text));
  expect(row).toBeTruthy();
  return row!;
}

function expectMousedownPrevented(row: HTMLButtonElement) {
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  row.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

afterEach(() => {
  cleanup();
});

describe('ComposerPlusMenu picker mousedown protection (#3195)', () => {

  it('the plugins picker prevents default on mousedown so the caret survives focus transfer', () => {
    renderMenu();
    openMenu();
    openSubmenu('Plugins');
    expectMousedownPrevented(pickerRow('Sample Plugin'));
  });

  it('the MCP picker prevents default on mousedown so the caret survives focus transfer', () => {
    renderMenu();
    openMenu();
    openSubmenu('MCP');
    expectMousedownPrevented(pickerRow('Slack MCP'));
  });
});
