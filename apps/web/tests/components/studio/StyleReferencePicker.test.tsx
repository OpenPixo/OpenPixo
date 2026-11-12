// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectAsset } from '@openpixo/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StyleReferencePicker } from '../../../src/components/studio/StyleReferencePicker';
import { setProjectStyleReference } from '../../../src/providers/styles';

vi.mock('../../../src/i18n', () => ({ useI18n: () => ({ locale: 'en', t: (key: string) => key }) }));
vi.mock('../../../src/providers/styles', () => ({ setProjectStyleReference: vi.fn() }));

const asset = (relPath: string, kind: ProjectAsset['kind'] = 'image') => ({ relPath, kind } as ProjectAsset);

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setProjectStyleReference).mockResolvedValue({ styleId: null, style: null, referenceImage: 'concept/style-2.png' });
});

describe('style reference picker', () => {
  it('offers only the game\'s images and saves the pick', async () => {
    render(<StyleReferencePicker projectId="game" current={null}
      assets={[asset('concept/style-2.png'), asset('audio/hit.wav', 'audio'), asset('art/notes.svg'), asset('assets/hero.webp')]} />);
    expect(screen.getByText('studio.styleReference.none')).toBeTruthy();
    const options = [...(screen.getByLabelText('studio.styleReference.none') as HTMLSelectElement).options].map(option => option.value);
    expect(options).toEqual(['', 'assets/hero.webp', 'concept/style-2.png']);
    fireEvent.change(screen.getByLabelText('studio.styleReference.none'), { target: { value: 'concept/style-2.png' } });
    fireEvent.click(screen.getByText('studio.styleReference.set'));
    await waitFor(() => expect(setProjectStyleReference).toHaveBeenCalledWith('game', 'concept/style-2.png', undefined, 'en'));
  });

  it('shows the current reference and clears it', async () => {
    render(<StyleReferencePicker projectId="game" current="concept/style-2.png" assets={[asset('concept/style-2.png')]} />);
    expect(screen.getByText('studio.styleReference.current')).toBeTruthy();
    expect(document.querySelector('img')?.getAttribute('src')).toBe('/api/projects/game/raw/concept/style-2.png');
    fireEvent.click(screen.getByText('studio.styleReference.clear'));
    await waitFor(() => expect(setProjectStyleReference).toHaveBeenCalledWith('game', null, undefined, 'en'));
  });

  it('changes nothing for a viewer', () => {
    render(<StyleReferencePicker projectId="game" current="concept/style-2.png" assets={[asset('concept/style-2.png')]} disabled />);
    fireEvent.click(screen.getByText('studio.styleReference.clear'));
    expect(setProjectStyleReference).not.toHaveBeenCalled();
  });
});
