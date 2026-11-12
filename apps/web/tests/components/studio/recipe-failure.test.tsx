// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CandidateGrid } from '../../../src/components/studio/CandidateGrid';
import { I18nProvider } from '../../../src/i18n';
import type { RecipeRun } from '@openpixo/contracts';
afterEach(cleanup);
it('localizes a failed Codex recipe and its candidates in Chinese', () => {
  const run: RecipeRun = { id: 'run', recipeId: 'sprite', projectId: 'game', recipeVersion: '1', inputs: {}, model: { provider: 'codex-cli', id: 'codex-image' }, status: 'failed', createdAt: 0, updatedAt: 0,
    error: 'Raw sign-in diagnostic', errorCode: 'CODEX_CLI_AUTH_REQUIRED', candidates: [{ id: 'c1', index: 0, stagedFiles: [], checks: [], error: 'Raw sign-in diagnostic', errorCode: 'CODEX_CLI_AUTH_REQUIRED' }] };
  render(<I18nProvider initial="zh-CN"><CandidateGrid run={run} selected={[]} pending={false} onSelect={vi.fn()} onAdopt={vi.fn()} onOpenFile={vi.fn()} /></I18nProvider>);
  expect(screen.getByRole('alert').textContent).toContain('登录');
  expect(screen.queryByText('Raw sign-in diagnostic')).toBeNull();
});
