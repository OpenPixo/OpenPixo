// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationHead } from '../../../src/components/workspace/ConversationHead';
import {
  PANEL_HIDDEN_STORAGE_KEY,
  readStoredPanelHidden,
  writeStoredPanelHidden,
} from '../../../src/components/project-split-layout';

vi.mock('../../../src/i18n', () => ({
  useT: () => (key: string) => ({
    'projectShell.hidePanel': 'Hide side panel',
    'projectShell.showPanel': 'Show side panel',
  }[key] ?? key),
}));

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe('conversation header (specs/current/openpixo-ui-cleanup.md §3)', () => {
  it('names the project and the session, and hosts the history control', () => {
    render(<ConversationHead projectName="Coin Run" sessionTitle="Add a double jump" historyRef={() => {}}
      panelVisible onTogglePanel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /Coin Run.*Add a double jump/ })).toBeTruthy();
    expect(screen.getByTestId('chat-history-dock')).toBeTruthy();
  });

  it('shows only the project while the session has no title of its own', () => {
    const view = render(<ConversationHead projectName="Coin Run" sessionTitle="  " historyRef={() => {}}
      panelVisible onTogglePanel={vi.fn()} />);
    expect(screen.getByRole('heading').textContent).toBe('Coin Run');
    view.rerender(<ConversationHead projectName="Coin Run" sessionTitle="Coin Run" historyRef={() => {}}
      panelVisible onTogglePanel={vi.fn()} />);
    expect(screen.getByRole('heading').textContent).toBe('Coin Run');
  });

  it('labels the panel toggle by what it will do', () => {
    const toggle = vi.fn();
    const view = render(<ConversationHead projectName="Coin Run" historyRef={() => {}} panelVisible onTogglePanel={toggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide side panel' }));
    expect(toggle).toHaveBeenCalledTimes(1);
    view.rerender(<ConversationHead projectName="Coin Run" historyRef={() => {}} panelVisible={false} onTogglePanel={toggle} />);
    expect(screen.getByRole('button', { name: 'Show side panel' }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('side panel visibility preference', () => {
  it('is shown until the user hides it, and remembers the choice', () => {
    expect(readStoredPanelHidden()).toBe(false);
    writeStoredPanelHidden(true);
    expect(localStorage.getItem(PANEL_HIDDEN_STORAGE_KEY)).toBe('true');
    expect(readStoredPanelHidden()).toBe(true);
    writeStoredPanelHidden(false);
    expect(readStoredPanelHidden()).toBe(false);
  });

  it('gives the conversation the whole split and centres it while the panel is hidden', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/workspace/project-shell.css'), 'utf8');
    expect(css).toMatch(/\.app \.split\.split-panel-hidden \{\s*grid-template-columns: minmax\(0, 1fr\) 0 0;/);
    expect(css).toMatch(/\.split-panel-hidden \.split-chat-slot > \.pane \{[^}]*max-width: var\(--shell-conversation-max-width\);[^}]*margin-inline: auto;/);
    const index = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    // Loaded after routines.css, whose floating-card rules it replaces.
    expect(index.indexOf("workspace/project-shell.css")).toBeGreaterThan(index.indexOf("viewer/routines.css"));
  });
});
