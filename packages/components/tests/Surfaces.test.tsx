// @vitest-environment jsdom

import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BorderBeam } from '../src/border-beam';
import { Card } from '../src/card';

afterEach(cleanup);

describe('Card', () => {
  it('keeps consumer semantics, attributes, and its forwarded ref', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Card ref={ref} role="region" aria-label="Templates" id="templates" interactive>
        <a href="/templates/platformer">Platformer</a>
      </Card>,
    );

    const card = screen.getByRole('region', { name: 'Templates' });
    expect(ref.current).toBe(card);
    expect(card.id).toBe('templates');
    expect(card.hasAttribute('interactive')).toBe(false);
    expect(screen.getByRole('link', { name: 'Platformer' }).getAttribute('href')).toBe('/templates/platformer');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('BorderBeam', () => {
  it('preserves accessible content and native event/ref forwarding when decorating a card', () => {
    const ref = createRef<HTMLDivElement>();
    const onClick = vi.fn();
    render(
      <BorderBeam ref={ref} data-testid="featured" onClick={onClick}>
        <Card><button type="button">Open template</button></Card>
      </BorderBeam>,
    );

    expect(ref.current).toBe(screen.getByTestId('featured'));
    fireEvent.click(screen.getByRole('button', { name: 'Open template' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
