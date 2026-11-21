// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button, Notice, NoticeRetry } from '../src';

afterEach(cleanup);

describe('Notice', () => {
  it('renders title, message and one action, with a polite status role by default', () => {
    render(
      <Notice title="已保存" action={<Button size="sm">查看</Button>}>
        下次打开时会接着上次的进度。
      </Notice>,
    );
    const notice = screen.getByRole('status');
    expect(notice.getAttribute('data-tone')).toBe('info');
    expect(notice.textContent).toContain('已保存');
    expect(notice.textContent).toContain('下次打开时会接着上次的进度。');
    expect(screen.getByRole('button', { name: '查看' })).toBeTruthy();
    expect(notice.querySelector('svg')).not.toBeNull();
  });

  it('marks a danger notice as an alert and can drop the icon', () => {
    render(<Notice tone="danger" icon={false}>没能连上服务。</Notice>);
    const notice = screen.getByRole('alert');
    expect(notice.getAttribute('data-tone')).toBe('danger');
    expect(notice.querySelector('svg')).toBeNull();
  });

  it('keeps a caller-supplied role and className', () => {
    render(<Notice tone="warning" role="note" className="extra">余额不多了。</Notice>);
    const notice = screen.getByRole('note');
    expect(notice.getAttribute('data-tone')).toBe('warning');
    expect(notice.className).toContain('extra');
  });
});

describe('NoticeRetry', () => {
  it('shows the failure and calls onRetry from its one button', () => {
    const onRetry = vi.fn();
    render(
      <NoticeRetry title="加载失败" retryLabel="重试" onRetry={onRetry}>
        没能读到游戏列表，检查网络后再试一次。
      </NoticeRetry>,
    );
    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain('加载失败');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the button while retrying', () => {
    render(<NoticeRetry title="加载失败" retryLabel="重试" onRetry={() => {}} retrying />);
    const button = screen.getByRole('button', { name: '重试' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
