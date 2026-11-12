import { describe, expect, it } from 'vitest';

import {
  listNamesConversation,
  routedConversationVerdict,
  type RoutedConversationInput,
} from '../../../src/runtime/chat/routed-conversation';

const settled: RoutedConversationInput = {
  routeId: 'a', previousRouteId: 'a', activeId: 'a', lastPushedId: 'a',
};

describe('routedConversationVerdict', () => {
  it('follows a route somebody else moved', () => {
    expect(routedConversationVerdict({ ...settled, routeId: 'b' })).toBe('follow');
  });

  it('follows back to a conversation it followed before', () => {
    // Route b was followed, a pick in the pane moved everything back to a, and
    // the sidebar now asks for b again.
    expect(routedConversationVerdict({
      routeId: 'b', previousRouteId: 'a', activeId: 'a', lastPushedId: 'a',
    })).toBe('follow');
  });

  it('stays when the route has not moved, however the rest of the view changed', () => {
    // A local switch moved the pane to b. The URL write is still in flight and
    // the view has already recorded it, so the stale route must not pull it back.
    expect(routedConversationVerdict({
      routeId: 'a', previousRouteId: 'a', activeId: 'b', lastPushedId: 'b',
    })).toBe('stay');
  });

  it('stays when the route is the value this view last wrote', () => {
    expect(routedConversationVerdict({
      routeId: 'a', previousRouteId: 'x', activeId: 'b', lastPushedId: 'a',
    })).toBe('stay');
  });

  it('stays when the pane already shows the routed conversation', () => {
    expect(routedConversationVerdict({
      routeId: 'b', previousRouteId: 'a', activeId: 'b', lastPushedId: 'a',
    })).toBe('stay');
  });

  it('leaves the first pick to the list load', () => {
    expect(routedConversationVerdict({
      routeId: 'b', previousRouteId: 'a', activeId: null, lastPushedId: null,
    })).toBe('stay');
  });

  it('ignores a route with no conversation', () => {
    expect(routedConversationVerdict({ ...settled, routeId: null })).toBe('stay');
  });
});

describe('listNamesConversation', () => {
  it('is satisfied by no route or a listed conversation, not by an unlisted one', () => {
    const list = [{ id: 'a' }];
    expect(listNamesConversation(list, null)).toBe(true);
    expect(listNamesConversation(list, 'a')).toBe(true);
    expect(listNamesConversation(list, 'b')).toBe(false);
  });
});
