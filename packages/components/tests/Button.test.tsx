// @vitest-environment jsdom

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from '../src/button';

afterEach(() => {
  cleanup();
});

describe('Button', () => {
  it('renders a type=button by default so it never submits an enclosing form', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('type')).toBe('button');
  });

  it('accepts the chat secondary variant and sm size without leaking legacy global classes', () => {
    render(
      <Button variant="secondary" size="sm">
        Retry
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Retry' });
    // Legacy compat classes (`primary`, `ghost`, `icon-btn`, …) are frozen; new
    // variants/sizes must not add to that surface.
    for (const legacy of ['primary', 'primary-ghost', 'ghost', 'subtle', 'icon-btn']) {
      expect(button.classList.contains(legacy)).toBe(false);
    }
  });

  it('keeps the caller className and disabled state', () => {
    render(
      <Button className="extra" disabled>
        Send
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(button.classList.contains('extra')).toBe(true);
    expect(button.disabled).toBe(true);
  });

  it('forwards refs and native button events for the large primary control', () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(<Button ref={ref} variant="primary" size="lg" onClick={onClick}>New game</Button>);

    const button = screen.getByRole('button', { name: 'New game' });
    expect(ref.current).toBe(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps native disabled behavior for the primary control', () => {
    const onClick = vi.fn();
    render(<Button variant="primary" disabled onClick={onClick}>New game</Button>);

    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('preserves pressed and disabled semantics for a ghost toggle', () => {
    const { rerender } = render(<Button variant="ghost" aria-pressed="true">Brush</Button>);
    const button = screen.getByRole('button', { name: 'Brush' }) as HTMLButtonElement;
    expect(button.getAttribute('aria-pressed')).toBe('true');

    rerender(<Button variant="ghost" aria-pressed="false" disabled>Brush</Button>);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.disabled).toBe(true);
  });
});
