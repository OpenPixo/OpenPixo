// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PRODUCT_SUPPORT_EMAIL } from '@openpixo/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SupportDialog } from '../../../src/components/chat/SupportDialog';
import { supportChannels } from '../../../src/components/chat/support-channels';
import { en } from '../../../src/i18n/locales/en';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const t = (key: keyof typeof en) => en[key];

describe('supportChannels', () => {
  it('offers the support email, and no row with a dead button', () => {
    const channels = supportChannels(t);
    expect(channels[0]?.href).toBe(`mailto:${PRODUCT_SUPPORT_EMAIL}`);
    expect(channels.every(channel => channel.href)).toBe(true);
  });

  it('opens the mail link from an enabled button', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<SupportDialog channels={supportChannels(t)} onClose={vi.fn()} inline />);
    expect(screen.getByText(PRODUCT_SUPPORT_EMAIL)).toBeTruthy();
    expect(screen.queryByText(en['openpixo.linkPending'])).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en['chat.support.emailAction'] }));
    expect(open.mock.calls[0]?.[0]).toBe(`mailto:${PRODUCT_SUPPORT_EMAIL}`);
  });
});
