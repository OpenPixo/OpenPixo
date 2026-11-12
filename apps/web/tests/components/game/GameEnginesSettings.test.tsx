// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GameEnginesSettings } from '../../../src/components/game/GameEnginesSettings';
import { I18nProvider } from '../../../src/i18n';

afterEach(cleanup);
it('lets the user set the Cocos Creator executable in Chinese settings', () => {
  const change = vi.fn();
  render(<I18nProvider initial="zh-CN"><GameEnginesSettings value={{ cocosCreator: 'creator' }} onChange={change} /></I18nProvider>);
  const input = screen.getByRole('textbox', { name: /Cocos Creator/ });
  expect((input as HTMLInputElement).value).toBe('creator');
  fireEvent.change(input, { target: { value: 'Creator.exe' } });
  expect(change).toHaveBeenCalledWith({ cocosCreator: 'Creator.exe' });
});
