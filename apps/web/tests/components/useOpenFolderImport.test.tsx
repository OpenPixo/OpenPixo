// @vitest-environment jsdom

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

vi.mock('@openpixo/host', () => ({
  isOpenPixoHostAvailable: () => true,
  pickAndImportHostProject: vi.fn(),
}));



import { pickAndImportHostProject } from '@openpixo/host';


afterEach(() => {
  cleanup();
  vi.mocked(pickAndImportHostProject).mockReset();
});


