// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextStageLine } from '../../../src/components/chat/NextStageLine';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const approved = { status: 'approved' as const, startedAt: 1, approvedAt: 2 };
const reply = '阶段 2 / 共 4：敌人与升级\n\n做好了，按方向键试试。';

function renderLine(props: Partial<Parameters<typeof NextStageLine>[0]> = {}) {
  const onStart = vi.fn(async () => true);
  render(<NextStageLine plan={approved} latestReply={reply} streaming={false} onStart={onStart} {...props} />);
  return { onStart };
}

describe('the next-stage offer', () => {
  it('offers the stage after the finished one and opens it on click', async () => {
    const { onStart } = renderLine();
    expect(screen.getByTestId('next-stage-line').className).toContain('open');
    const start = screen.getByTestId('next-stage-start');
    expect(start.textContent).toBe('Continue stage 3 of 4 in a new conversation');
    fireEvent.click(start);
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['while the agent works', { streaming: true }],
    ['for a viewer', { viewerOnly: true }],
    ['while planning', { plan: { status: 'planning' as const, startedAt: 1 } }],
    ['under a reply without a stage label', { latestReply: '剑光改亮了。' }],
    ['after the last stage', { latestReply: 'Stage 4 of 4: the boss' }],
    ['where the host cannot open a conversation', { onStart: undefined }],
  ])('stays closed %s', (_name, props) => {
    renderLine(props);
    expect(screen.getByTestId('next-stage-line').className).not.toContain(' open');
  });

  it('says so when the conversation could not be opened', async () => {
    renderLine({ onStart: vi.fn(async () => false) });
    fireEvent.click(screen.getByTestId('next-stage-start'));
    await screen.findByRole('alert');
  });
});
