// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PixoCard } from '@openpixo/contracts';
import { ExecutionShell } from '../../../src/components/chat/ExecutionShell';

import { I18nProvider } from '../../../src/i18n';
import type { ExecutionShell as Shell, ShellItem } from '../../../src/runtime/chat/contract';


const TASK_BRIEF = { kind: 'task-brief', summary: 'Keep <pixo-demo>brand wording</pixo-demo>', fields: [] } satisfies PixoCard;
const MEMORY_APPLIED = { kind: 'memory-applied', summary: 'Applied palette', used: [{ type: 'rule', name: 'Palette' }] } satisfies PixoCard;
const VERIFY_SCORECARD = { kind: 'verify-scorecard', status: 'pass', summary: 'Checks passed', rows: [{ rule: 'Palette', status: 'pass' }] } satisfies PixoCard;

function markup(card: PixoCard): string {
  return `<pixo-card type="${card.kind}">${JSON.stringify(card)}</pixo-card>`;
}

function shell(items: ShellItem[]): Shell {
  return {
    kind: 'shell', id: 'shell-1', status: 'running', stopped: false,
    thinking: false, elapsedMs: null, quietMs: null, items, segments: [],
  };
}

function show(items: ShellItem[], scope = 'project:conversation:run:message:shell') {
  return (
    <I18nProvider initial="en">
      <ExecutionShell shell={shell(items)} pixoCardScope={scope} deferCollapsedBodies={false} />
    </I18nProvider>
  );
}

function todo(content: string, text: string): ShellItem {
  return {
    kind: 'todo', segment: {
      content, status: 'in_progress', recalled: false, abandoned: false,
      implicit: false, elapsedMs: null, items: [{ kind: 'text', text }],
    },
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('execution shell card boundaries', () => {
  it('renders memory while preserving neighboring Markdown', () => {
    const card = MEMORY_APPLIED;
    const { container } = render(show([{ kind: 'text', text: `**Before**\n\n${markup(card)}\n\nAfter` }]));
    expect(container.querySelector(`[data-pixo-card="${card.kind}"]`)).not.toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('Before');
    expect(container.textContent).toContain('After');
  });

  it('consumes a retired verification card without exposing its payload or losing neighboring Markdown', () => {
    const { container } = render(show([{ kind: 'text', text: `**Before**\n\n${markup(VERIFY_SCORECARD)}\n\nAfter` }]));
    expect(container.querySelector('[data-pixo-card="verify-scorecard"]')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('Before');
    expect(container.textContent).toContain('After');
    expect(container.textContent).not.toContain(VERIFY_SCORECARD.summary);
    expect(container.textContent).not.toContain('<pixo-card');
  });

  it.each(['fenced', 'inline', 'unclosed fence'])('preserves a card quoted as %s code', (style) => {
    const raw = markup(TASK_BRIEF);
    const text = style === 'inline' ? `Example: \`${raw}\``
      : style === 'fenced' ? `\`\`\`xml\n${raw}\n\`\`\`` : `\`\`\`xml\n${raw}`;
    const { container } = render(show([{ kind: 'text', text }]));
    expect(container.querySelector('[data-pixo-card]')).toBeNull();
    expect(container.querySelector('code')?.textContent).toContain(raw);
  });

  it('keeps code examples and real cards in their original order', () => {
    const raw = markup(TASK_BRIEF);
    const { container } = render(show([{ kind: 'text', text: `\`${raw}\`\n\n${markup(MEMORY_APPLIED)}\n\nTail` }]));
    const code = container.querySelector('code');
    const card = container.querySelector('[data-pixo-card="memory-applied"]');
    expect(code?.textContent).toBe(raw);
    expect(card).not.toBeNull();
    expect(code!.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(container.textContent).toContain('Tail');
  });

  it('reveals a streamed card only after it closes and preserves terminal malformed text', () => {
    const raw = markup(MEMORY_APPLIED);
    const { container, rerender } = render(show([{ kind: 'text', text: `Before\n${raw.slice(0, -10)}` }]));
    expect(container.textContent).toContain('Before');
    expect(container.textContent).not.toContain('<pixo-card');
    rerender(show([{ kind: 'text', text: `Before\n${raw}\nAfter` }]));
    expect(container.querySelector('[data-pixo-card="memory-applied"]')).not.toBeNull();
    expect(container.textContent).toContain('After');
    const malformed = '<pixo-card type="task-brief">not JSON';
    rerender(<I18nProvider initial="en"><ExecutionShell shell={{ ...shell([{ kind: 'text', text: malformed }]), status: 'done' }} deferCollapsedBodies={false} /></I18nProvider>);
    expect(container.textContent).toContain(malformed);
  });

  it('holds live opener prefixes without hiding earlier prose or losing the completed card', () => {
    // Real ACP/SSE QA on 201ba003 exposed "<pixo-ca" in an expanded shell
    // after event 18, before the remainder of the same legitimate card arrived.
    const raw = markup(MEMORY_APPLIED);
    const openerEnd = raw.indexOf('>');
    const { container, rerender } = render(show([{ kind: 'text', text: 'D2 SSE before.' }]));
    for (let length = '<pixo-ca'.length; length <= openerEnd; length += 1) {
      const prefix = raw.slice(0, length);
      rerender(show([{ kind: 'text', text: `D2 SSE before.\n${prefix}` }]));
      expect(container.textContent).toContain('D2 SSE before.');
      expect(container.textContent).not.toContain('<pixo-ca');
      expect(container.querySelector('[data-pixo-card]')).toBeNull();
    }
    rerender(show([{ kind: 'text', text: `D2 SSE before.\n${raw}\nD2 SSE after.` }]));
    expect(container.querySelectorAll('[data-pixo-card="memory-applied"]')).toHaveLength(1);
    expect(container.textContent).toContain(MEMORY_APPLIED.summary);
    expect(container.textContent).toContain('D2 SSE before.');
    expect(container.textContent).toContain('D2 SSE after.');
  });

  it.each(['inline', 'fenced', 'unclosed fence'])('keeps a partial card opener quoted as %s code', (style) => {
    const prefix = '<pixo-ca';
    const example = style === 'inline' ? `Example: \`${prefix}\``
      : style === 'fenced' ? `\`\`\`xml\n${prefix}\n\`\`\`` : `\`\`\`xml\n${prefix}`;
    const { container } = render(show([{ kind: 'text', text: `Before.\n\n${example}` }]));
    expect(container.textContent).toContain('Before.');
    expect(container.querySelector('code')?.textContent).toContain(prefix);
    expect(container.querySelector('[data-pixo-card]')).toBeNull();
  });

  it('keeps ordinary live prose when a candidate continues as a different tag name', () => {
    const text = 'Before. Compare 5 < 7. <pixo-card-example is a literal example. After.';
    const { container } = render(show([{ kind: 'text', text }]));
    expect(container.textContent).toContain(text);
    expect(container.querySelector('[data-pixo-card]')).toBeNull();
  });

  it('restores terminal literal opener prefixes that never became a card', () => {
    const raw = markup(TASK_BRIEF);
    const openerEnd = raw.indexOf('>');
    const { container, rerender } = render(show([]));
    for (let length = '<pixo-ca'.length; length <= openerEnd; length += 1) {
      const prefix = raw.slice(0, length);
      const text = `Before.\n${prefix}`;
      rerender(<I18nProvider initial="en"><ExecutionShell shell={{ ...shell([{ kind: 'text', text }]), status: 'done' }} deferCollapsedBodies={false} /></I18nProvider>);
      expect(container.textContent).toContain('Before.');
      // SayText trims its Markdown input; preserve visible prefix characters,
      // including unfinished attributes, without requiring trailing whitespace.
      expect(container.textContent).toContain(prefix.trimEnd());
      expect(container.querySelector('[data-pixo-card]')).toBeNull();
    }
  });

  it('keeps memory disclosure local to each todo and preserves both cards on remount', () => {
    const raw = markup(MEMORY_APPLIED);
    const items = [todo('First step', raw), todo('Second step', raw)];
    const first = render(show(items));
    const cards = first.container.querySelectorAll<HTMLDetailsElement>('[data-pixo-card="memory-applied"]');
    expect(cards).toHaveLength(2);
    const [firstCard, secondCard] = cards;
    if (!firstCard || !secondCard) throw new Error('Missing independent todo cards');
    const summary = firstCard.querySelector('summary');
    if (!summary) throw new Error('Missing memory disclosure control');
    fireEvent.click(summary);
    expect(firstCard.open).toBe(true);
    expect(secondCard.open).toBe(false);
    first.unmount();
    const remount = render(show(items));
    expect(remount.container.querySelectorAll('[data-pixo-card="memory-applied"]')).toHaveLength(2);
    expect(remount.container.querySelectorAll('[data-pixo-card="memory-applied"][open]')).toHaveLength(0);
    cleanup();
    const other = render(show(items, 'another-conversation'));
    expect(other.container.querySelectorAll('[data-pixo-card="memory-applied"]')).toHaveLength(2);
  });
});
