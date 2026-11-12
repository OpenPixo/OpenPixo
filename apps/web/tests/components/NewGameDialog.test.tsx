// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameFolderNameProblem, type ArtStyle, type GameTemplateSummary, type CreateGameFromTemplateResponse } from '@openpixo/contracts';
import { isOpenPixoHostAvailable, pickHostWorkingDir, authorizeHostGameParent } from '@openpixo/host';
import { NewGameDialog } from '../../src/components/NewGameDialog';
import {
  isAbsoluteFolderPath,
  pickerTokenExpiry,
  previewGameTarget,
  splitTemplateName,
} from '../../src/components/new-game-target';
import { checkGameTarget, fetchGameTemplates, GameTemplateRequestError } from '../../src/state/game-templates';
import { createGameFromTemplate } from '../../src/components/NewGameDialog.api';
import { fetchProjectLocations } from '../../src/state/project-locations';
import { saveGameSetup, uploadReferences } from '../../src/components/new-game/game-setup-api';
import { openExternalUrl } from '../../src/providers/registry';
import { fetchGameExperience, saveGameExperience } from '../../src/components/new-game/experience';
import { emptyDraft, type WizardDraft } from '../../src/components/new-game/wizard-state';
import { en } from '../../src/i18n/locales/en';
import { zhCN } from '../../src/i18n/locales/zh-CN';

const localeState = vi.hoisted(() => ({ locale: 'en' as 'en' | 'zh-CN' }));
function translate(key: keyof typeof en, vars?: Record<string, string>) {
  const dict = localeState.locale === 'zh-CN' ? zhCN : en;
  return dict[key].replace(/\{(\w+)\}/g, (_, name: string) => vars?.[name] ?? `{${name}}`);
}

vi.mock('../../src/i18n', () => ({
  useT: () => translate,
  useI18n: () => ({ t: translate, locale: localeState.locale }),
}));
vi.mock('../../src/state/projects', () => ({ pickLocalFolderPath: vi.fn() }));
vi.mock('../../src/components/NewGameDialog.api', () => ({ createGameFromTemplate: vi.fn() }));
vi.mock('../../src/state/project-locations', () => ({ fetchProjectLocations: vi.fn() }));
vi.mock('../../src/providers/styles', () => ({ listArtStyles: vi.fn(async () => styleCatalogue) }));
vi.mock('../../src/components/new-game/game-setup-api', () => ({ saveGameSetup: vi.fn(), uploadReferences: vi.fn() }));
vi.mock('../../src/providers/registry', () => ({ openExternalUrl: vi.fn() }));
vi.mock('../../src/components/new-game/experience', () => ({ fetchGameExperience: vi.fn(), saveGameExperience: vi.fn() }));
vi.mock('@openpixo/host', () => ({ isOpenPixoHostAvailable: vi.fn(), pickHostWorkingDir: vi.fn(), authorizeHostGameParent: vi.fn() }));
vi.mock('../../src/state/game-templates', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/state/game-templates')>()),
  checkGameTarget: vi.fn(), createGameFromTemplate: vi.fn(), fetchGameTemplates: vi.fn(),
}));

const created: CreateGameFromTemplateResponse = {
  project: { id: 'game-id', name: 'tiny-game', skillId: null, createdAt: 1, updatedAt: 1 },
  conversationId: 'conversation-id', entryFile: 'index.html',
  git: { status: 'skipped', reasonCode: 'GIT_MISSING' },
};
const pickerToken = `nonce~${new Date(Date.now() + 60_000).toISOString()}~sig`;

const styleCatalogue = vi.hoisted(() => [
  { id: 'pixel-16-bit', title: 'Retro pixel · 16-bit', description: 'Pixel', dimension: ['2d'], medium: ['pixel'],
    prompt: 'pixels', negativePrompt: '', palette: ['#182238', '#F0D8A8'], previews: [], license: 'MIT' },
  { id: 'low-poly-3d', title: 'Low poly', description: '3D', dimension: ['3d'], medium: ['3d'],
    prompt: 'polys', negativePrompt: '', previews: [], license: 'MIT' },
] as ArtStyle[]);

const sampleTemplate: GameTemplateSummary = {
  id: 'phaser3-sample-platformer', name: 'Sample: pixel platformer', nameZhCN: '示例：像素平台跳跃',
  engine: 'phaser', description: en['game.template.phaser3-sample-platformer'],
  descriptionZhCN: zhCN['game.template.phaser3-sample-platformer'],
};

beforeEach(() => {
  localStorage.clear();
  localeState.locale = 'en';
  vi.mocked(isOpenPixoHostAvailable).mockReturnValue(true);
  // Someone who has made a game before: no experience screen, and every view and engine.
  vi.mocked(fetchGameExperience).mockResolvedValue('some');
  vi.mocked(saveGameExperience).mockResolvedValue(undefined);
  vi.mocked(fetchProjectLocations).mockResolvedValue([]);
  vi.mocked(fetchGameTemplates).mockResolvedValue({ templates: [
    { id: 'phaser3-vite', name: 'Phaser 3 · 2D', engine: 'phaser', description: 'Starter' },
    { id: 'threejs-vite', name: 'Three.js · 3D', engine: 'threejs', description: 'Cube' },
    sampleTemplate,
  ] });
  vi.mocked(pickHostWorkingDir).mockResolvedValue({ ok: true, baseDir: 'C:\\Games', token: pickerToken });
  vi.mocked(checkGameTarget).mockImplementation(async input => ({
    status: 'available', target: `${input.parentDir}\\${input.name}`,
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

/** Hosts the dialog the way Home does: closing it unmounts it. */
function DialogHost({ onCreated }: { onCreated: () => void }) {
  const [isOpen, setIsOpen] = useState(true);
  return isOpen ? <NewGameDialog onClose={() => setIsOpen(false)} onCreated={onCreated} /> : null;
}

async function open(onCreated = vi.fn()) {
  render(<DialogHost onCreated={onCreated} />);
  await screen.findByTestId(/^wizard-step-/);
  // A restored review step can create once the templates have loaded.
  if (screen.queryByTestId('wizard-step-review')) await waitFor(() => expect((screen.getByTestId('wizard-next') as HTMLButtonElement).disabled).toBe(false));
  return onCreated;
}

/** A draft with every setup screen answered, reopened on Review & create. */
function answeredDraft(templateId = 'phaser3-vite'): WizardDraft {
  return { ...emptyDraft(templateId), title: 'my-game', scope: 'crafted', genre: 'platformer', perspective: 'side-2d', styleId: 'pixel-16-bit', kickoff: false,
    palette: ['#182238', '#F0D8A8'], pixelSize: 16, resolution: '640x360', scaling: 'pixel-perfect', controls: ['keyboard'] };
}
function seedReview(templateId?: string) {
  localStorage.setItem('pixo:new-game-draft.v3', JSON.stringify(answeredDraft(templateId)));
  localStorage.setItem('pixo:new-game-draft-step.v3', 'review');
}
const nextButton = () => screen.getByTestId('wizard-next') as HTMLButtonElement;
// The engine cards are the first radio group on the engine screen.
const templateRadios = () => within(screen.getAllByRole('radiogroup')[0]!).getAllByRole('radio');
const currentStep = () => screen.getByTestId(/^wizard-step-/).getAttribute('data-testid')!.replace('wizard-step-', '');

/** Continue through already answered screens until `step` is open. */
async function continueTo(step: string) {
  for (let guard = 0; guard < 8 && currentStep() !== step; guard++) {
    const before = currentStep();
    await waitFor(() => expect(nextButton().disabled).toBe(false));
    fireEvent.click(nextButton());
    await waitFor(() => expect(currentStep()).not.toBe(before));
  }
  return screen.getByTestId(`wizard-step-${step}`);
}

/** Answer size, concept, view and art through the UI, ending on the engine screen. */
async function answerToEngine(perspective = '2D side view', scope = /^Crafted/) {
  await screen.findByTestId('wizard-step-size');
  fireEvent.click(screen.getByRole('radio', { name: scope }));
  fireEvent.click(nextButton());
  await screen.findByTestId('wizard-step-concept');
  fireEvent.change(screen.getByLabelText(/^Game title/), { target: { value: 'Hollow Fox' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Platformer' }));
  fireEvent.click(nextButton());
  await screen.findByTestId('wizard-step-view');
  fireEvent.click(screen.getByRole('radio', { name: perspective }));
  fireEvent.click(nextButton());
  fireEvent.click(await screen.findByRole('radio', { name: styleCatalogue[0]!.title }));
  fireEvent.click(nextButton());
  await screen.findByTestId('wizard-step-setup');
}

/** The whole wizard, ending on Review & create. */
async function completeWizard(perspective?: string) {
  await answerToEngine(perspective);
  fireEvent.click(nextButton());
  await screen.findByTestId('wizard-step-review');
}

/** Open the engine screen of a sample started from Home, whose answers are already filled in. */
async function openSampleEngineStep() {
  await screen.findByTestId(/^wizard-step-/);
  await continueTo('setup');
}

/** Open the "More settings" fold on the current screen. */
function openMore(name: RegExp | string = /^More settings/) {
  fireEvent.click(screen.getAllByRole('button', { name })[0]!);
}

async function chooseParentAndName(name = ' tiny-game ') {
  fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /Browse/ }));
  await screen.findByText('Ready to create');
}

describe('NewGameDialog', () => {
  it('shows the quick sample failure in the preselected fallback wizard', async () => {
    render(<NewGameDialog initialTemplateId={sampleTemplate.id} onClose={vi.fn()} onCreated={vi.fn()}
      initialError={new GameTemplateRequestError('disk full', 500, 'CREATE_FAILED')} />);
    expect((await screen.findByRole('alert')).textContent).toBe(en['game.createFailed']);
    expect(screen.getByText('disk full').closest('details')?.open).toBe(false);
    await openSampleEngineStep();
    expect((await screen.findByRole('radio', { name: sampleTemplate.name })).getAttribute('aria-checked')).toBe('true');
  });

  it.each([false, true])('automatically creates a missing daemon default parent (host: %s)', async hostMode => {
    vi.useFakeTimers();
    seedReview(sampleTemplate.id);
    vi.mocked(isOpenPixoHostAvailable).mockReturnValue(hostMode);
    vi.mocked(fetchGameTemplates).mockResolvedValue({ templates: [sampleTemplate], defaultParentDir: 'C:\\Games' });
    vi.mocked(authorizeHostGameParent).mockResolvedValue({ ok: true, baseDir: 'C:\\Games', token: pickerToken });
    vi.mocked(checkGameTarget).mockImplementation(async input => input.createParent
      ? { status: 'available', target: 'C:\\Games\\my-game' }
      : { status: 'invalid-parent', reasonCode: 'PARENT_NOT_FOUND' });
    vi.mocked(createGameFromTemplate).mockResolvedValue(created);
    render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => {});
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect((screen.getByRole('checkbox', { name: 'Create this folder' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText(en['game.dialog.locationNotFound'])).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByText('Ready to create')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create game' }));
    await act(async () => {});
    expect(createGameFromTemplate).toHaveBeenCalledWith(expect.objectContaining({ parentDir: 'C:\\Games', createParent: true }), hostMode ? pickerToken : undefined);
    if (hostMode) expect(authorizeHostGameParent).toHaveBeenCalledWith('C:\\Games');
  });

  /*
   * 2026-11-10 beginner audit: on a fresh computer the last setup screen opened with
   * 「请点击“浏览…”在系统窗口中确认这个位置」 in red. The daemon answers an unauthorized
   * parent with `picker-required` before it reveals whether the folder exists, so the
   * auto-tick above (which waits for PARENT_NOT_FOUND) never fired in the desktop app.
   * This mock answers in the real daemon's order.
   */
  it.each([false, true])('authorizes the untouched default folder in the desktop app (folder exists: %s)', async exists => {
    vi.useFakeTimers();
    seedReview(sampleTemplate.id);
    vi.mocked(fetchGameTemplates).mockResolvedValue({ templates: [sampleTemplate], defaultParentDir: 'C:\\Games' });
    vi.mocked(authorizeHostGameParent).mockResolvedValue({ ok: true, baseDir: 'C:\\Games', token: pickerToken });
    vi.mocked(checkGameTarget).mockImplementation(async (input, token) => !token
      ? { status: 'picker-required', message: 'Choose this folder with the system picker first.' }
      : exists || input.createParent ? { status: 'available', target: 'C:\\Games\\my-game' }
        : { status: 'invalid-parent', reasonCode: 'PARENT_NOT_FOUND' });
    vi.mocked(createGameFromTemplate).mockResolvedValue(created);
    render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => {});
    for (let i = 0; i < 4; i++) await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.queryByText(en['game.dialog.locationPicker'])).toBeNull();
    expect(authorizeHostGameParent).toHaveBeenCalledWith('C:\\Games');
    expect(screen.getByText('Ready to create')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create game' }));
    await act(async () => {});
    expect(createGameFromTemplate).toHaveBeenCalledWith(expect.objectContaining({ parentDir: 'C:\\Games', ...(exists ? {} : { createParent: true }) }), pickerToken);
  });

  /*
   * 2026-11-11 Sol roguelike run: the default folder is vouched for when the name is
   * filled in (screen 3), and the host's confirmation lasts a minute. Anyone who took
   * longer to reach the last screen met 「位置确认已过期，请点击“浏览…”重新确认」 for a
   * folder they never chose.
   */
  it('vouches for the untouched default folder again when its confirmation lapses', async () => {
    vi.useFakeTimers();
    seedReview(sampleTemplate.id);
    vi.mocked(fetchGameTemplates).mockResolvedValue({ templates: [sampleTemplate], defaultParentDir: 'C:\\Games' });
    vi.mocked(authorizeHostGameParent).mockImplementation(async () => (
      { ok: true, baseDir: 'C:\\Games', token: `nonce~${new Date(Date.now() + 60_000).toISOString()}~sig` }));
    vi.mocked(checkGameTarget).mockImplementation(async (_input, token) => token
      ? { status: 'available', target: 'C:\\Games\\my-game' }
      : { status: 'picker-required', message: 'Choose this folder with the system picker first.' });
    vi.mocked(createGameFromTemplate).mockResolvedValue(created);
    render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => {});
    for (let i = 0; i < 4; i++) await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByText('Ready to create')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    for (let i = 0; i < 4; i++) await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.queryByText(en['game.dialog.locationExpired'])).toBeNull();
    expect(authorizeHostGameParent).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Ready to create')).toBeTruthy();
  });

  it('still asks for the picker when the desktop app will not vouch for the default folder', async () => {
    vi.useFakeTimers();
    seedReview(sampleTemplate.id);
    vi.mocked(fetchGameTemplates).mockResolvedValue({ templates: [sampleTemplate], defaultParentDir: 'C:\\Games' });
    vi.mocked(authorizeHostGameParent).mockResolvedValue({ ok: false, reason: 'refused' });
    vi.mocked(checkGameTarget).mockResolvedValue({ status: 'picker-required', message: 'Choose this folder with the system picker first.' });
    render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => {});
    for (let i = 0; i < 4; i++) await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByText(en['game.dialog.locationPicker'])).toBeTruthy();
    expect(authorizeHostGameParent).toHaveBeenCalledTimes(1);
  });

  it.each(['typed', 'picked'])('keeps a missing %s parent an explicit opt-in', async source => {
    vi.useFakeTimers();
    seedReview();
    vi.mocked(fetchGameTemplates).mockResolvedValue({ templates: [sampleTemplate], defaultParentDir: 'C:\\Games' });
    vi.mocked(pickHostWorkingDir).mockResolvedValue({ ok: true, baseDir: 'D:\\Missing', token: pickerToken });
    vi.mocked(checkGameTarget).mockResolvedValue({ status: 'invalid-parent', reasonCode: 'PARENT_NOT_FOUND' });
    render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => {});
    if (source === 'typed') fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'D:\\Missing' } });
    else {
      fireEvent.click(screen.getByRole('button', { name: /Browse/ }));
      await act(async () => {});
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByText(en['game.dialog.locationNotFound'])).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Create this folder' }) as HTMLInputElement).checked).toBe(false);
    expect(authorizeHostGameParent).not.toHaveBeenCalled();
  });

  it('prefills the daemon Documents default and remembers a user change', async () => {
    seedReview(sampleTemplate.id);
    vi.mocked(fetchGameTemplates).mockResolvedValue({ templates: [sampleTemplate], defaultParentDir: 'C:\\Users\\me\\OneDrive\\Documents\\OpenPixo Games' });
    const view = render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    const parent = await screen.findByLabelText('Location') as HTMLInputElement;
    await waitFor(() => expect(parent.value).toBe('C:\\Users\\me\\OneDrive\\Documents\\OpenPixo Games'));
    fireEvent.change(parent, { target: { value: 'D:\\My Games' } });
    view.unmount();
    render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    expect((await screen.findByLabelText('Location') as HTMLInputElement).value).toBe('D:\\My Games');
  });

  it('creates a missing parent only after the user opts in', async () => {
    vi.mocked(isOpenPixoHostAvailable).mockReturnValue(false);
    vi.mocked(checkGameTarget).mockImplementation(async input => input.createParent
      ? { status: 'available', target: 'C:\\new\\games\\my-game' }
      : { status: 'invalid-parent', reasonCode: 'PARENT_NOT_FOUND', message: 'parentDir not found' });
    vi.mocked(createGameFromTemplate).mockResolvedValue(created);
    seedReview();
    render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Location'), { target: { value: 'C:\\new\\games' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Create this folder' }));
    await screen.findByText('Ready to create');
    fireEvent.click(screen.getByRole('button', { name: 'Create game' }));
    await waitFor(() => expect(createGameFromTemplate).toHaveBeenCalledWith(expect.objectContaining({ createParent: true }), undefined));
  });

  it('maps a daemon reason into Chinese and keeps unknown details in a disclosure', async () => {
    localeState.locale = 'zh-CN';
    vi.mocked(createGameFromTemplate).mockRejectedValue(new GameTemplateRequestError('parentDir not found', 400, 'PARENT_NOT_FOUND'));
    seedReview();
    render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /浏览/ }));
    await screen.findByText('可以创建');
    fireEvent.click(screen.getByRole('button', { name: '创建游戏' }));
    expect((await screen.findByRole('alert')).textContent).toBe(zhCN['game.dialog.locationNotFound']);
    expect(screen.queryByText(/parentDir not found/)).toBeNull();
  });
  it.each(['en', 'zh-CN'] as const)('shows the sample name, description, and tag in %s', async locale => {
    localeState.locale = locale;
    const dict = locale === 'zh-CN' ? zhCN : en;
    render(<NewGameDialog initialTemplateId={sampleTemplate.id} onClose={vi.fn()} onCreated={vi.fn()} />);
    await openSampleEngineStep();
    const name = locale === 'zh-CN' ? sampleTemplate.nameZhCN : sampleTemplate.name;
    const sample = await screen.findByRole('radio', { name });
    expect(sample.textContent).toContain(dict['game.template.sampleTag']);
    expect(sample.textContent).toContain(dict['game.template.phaser3-sample-platformer']);
    expect(sample.querySelector('svg')).toBeTruthy();
    expect(templateRadios().at(-1)).toBe(sample);
    fireEvent.click(sample);
    expect(sample.getAttribute('aria-checked')).toBe('true');
  });

  it('preselects the requested sample after templates load even when another template is first', async () => {
    render(<NewGameDialog
      initialTemplateId="phaser3-sample-platformer"
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />);

    await openSampleEngineStep();
    const sample = await screen.findByRole('radio', { name: sampleTemplate.name });
    const starter = screen.getByRole('radio', { name: /Phaser/ });
    expect(templateRadios()[0]).toBe(starter);
    expect(starter.getAttribute('aria-checked')).toBe('false');
    expect(sample.getAttribute('aria-checked')).toBe('true');
    expect(sample.tabIndex).toBe(0);
  });

  it('creates a new game on the starter the answers suggest, with the whole setup', async () => {
    vi.mocked(createGameFromTemplate).mockResolvedValue(created);
    await open();
    await completeWizard();
    await chooseParentAndName();
    fireEvent.click(screen.getByRole('button', { name: 'Create and start planning' }));
    await waitFor(() => expect(createGameFromTemplate).toHaveBeenCalledWith({
      templateId: 'phaser3-vite', parentDir: 'C:\\Games', name: 'tiny-game',
      // No store, system, price or milestone: the dialog no longer asks them.
      setup: {
        title: 'Hollow Fox', genre: 'platformer', perspective: 'side-2d', players: ['single'], scope: 'crafted',
        release: { languages: ['en'] },
        // The style's palette is not copied in: colour follows the style and the sample picked while planning.
        art: { styleId: 'pixel-16-bit', pixelSize: 16 },
        display: { width: 480, height: 270, scaling: 'pixel-perfect' }, controls: ['keyboard'],
        // This walk never touched them, so the agent hears they were filled in, not chosen.
        suggested: ['languages', 'display', 'controls'],
      },
    }, pickerToken));
  });

  it('says in one plain line what each engine means and whether this computer can run it', async () => {
    vi.mocked(fetchGameTemplates).mockResolvedValue({
      templates: [{ id: 'godot4-2d', name: 'Godot 4 · 2D', engine: 'godot', description: 'Starter' }, { id: 'phaser3-vite', name: 'Phaser 3 · 2D', engine: 'phaser', description: 'Starter' }],
      engines: [
        { engine: 'godot', name: 'Godot', templates: [], available: false, missingTools: ['godot'] },
        { engine: 'phaser', name: 'Phaser', templates: [], available: true, missingTools: [] },
      ],
    });
    render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    await answerToEngine();
    const godot = await screen.findByRole('radio', { name: /Godot/ });
    const phaser = screen.getByRole('radio', { name: /Phaser/ });
    expect(godot.textContent).toContain(en['game.wizard.engineMeans.godot']);
    expect(godot.textContent).toContain(en['game.wizard.engineMissing'].replace('{tool}', 'Godot'));
    expect(phaser.textContent).toContain(en['game.wizard.engineMeans.web']);
    expect(phaser.textContent).toContain(en['game.wizard.engineReady']);
    expect(phaser.getAttribute('aria-checked')).toBe('true');
    // The screen size and controls are already set, folded under More settings.
    expect(screen.getByTestId('setup-more').getAttribute('data-open')).toBe('false');
  });

  describe('an engine this computer does not have', () => {
    const godotTemplates = [
      { id: 'godot4-2d', name: 'Godot 4 · 2D', engine: 'godot' as const, description: 'Starter' },
      { id: 'phaser3-vite', name: 'Phaser 3 · 2D', engine: 'phaser' as const, description: 'Starter' },
    ];
    const machine = (godot: boolean) => ({ templates: godotTemplates, engines: [
      { engine: 'godot' as const, name: 'Godot', templates: [], available: godot, missingTools: godot ? [] : ['godot'] },
      { engine: 'phaser' as const, name: 'Phaser', templates: [], available: true, missingTools: [] },
    ] });
    const missingText = en['game.wizard.engineMissingTitle'].replace('{tool}', 'Godot');

    async function chooseGodot(onOpenEngineSettings?: () => void, onClose = vi.fn()) {
      vi.mocked(fetchGameTemplates).mockResolvedValue(machine(false));
      render(<NewGameDialog onClose={onClose} onCreated={vi.fn()} {...(onOpenEngineSettings ? { onOpenEngineSettings } : {})} />);
      await answerToEngine();
      fireEvent.click(await screen.findByRole('radio', { name: /Godot/ }));
    }

    it('blocks Continue with the reason, and offers a one-click switch to an engine that runs here', async () => {
      await chooseGodot();
      const panel = screen.getByTestId('engine-missing');
      expect(panel.textContent).toContain(missingText);
      expect(panel.textContent).toContain(en['game.wizard.engineMissingGodotTip']);
      expect(nextButton().disabled).toBe(true);
      expect(screen.getByText(en['game.wizard.problem.engine'])).toBeTruthy();
      fireEvent.click(within(panel).getByRole('button', { name: en['game.wizard.engineSwitch'].replace('{engine}', 'Phaser 3') }));
      expect(screen.getByRole('radio', { name: /Phaser/ }).getAttribute('aria-checked')).toBe('true');
      expect(screen.queryByTestId('engine-missing')).toBeNull();
      expect(nextButton().disabled).toBe(false);
    });

    it('opens the official download, and checks again after the user installs it', async () => {
      await chooseGodot();
      const panel = screen.getByTestId('engine-missing');
      fireEvent.click(within(panel).getByRole('button', { name: en['game.wizard.engineDownload'].replace('{tool}', 'Godot') }));
      expect(openExternalUrl).toHaveBeenCalledWith('https://godotengine.org/download/windows/');

      // Still missing: said so, and still blocked.
      fireEvent.click(within(panel).getByRole('button', { name: en['game.wizard.engineRecheck'] }));
      expect(await screen.findByText(en['game.wizard.engineStillMissing'].replace('{tool}', 'Godot'))).toBeTruthy();
      expect(nextButton().disabled).toBe(true);

      vi.mocked(fetchGameTemplates).mockResolvedValue(machine(true));
      fireEvent.click(within(screen.getByTestId('engine-missing')).getByRole('button', { name: en['game.wizard.engineRecheck'] }));
      await waitFor(() => expect(screen.queryByTestId('engine-missing')).toBeNull());
      expect(screen.getByRole('radio', { name: /Godot/ }).getAttribute('aria-checked')).toBe('true');
      expect(nextButton().disabled).toBe(false);
    });

    it('sends the user to Settings to point at an install it could not find, keeping the draft', async () => {
      const onOpenEngineSettings = vi.fn();
      const onClose = vi.fn();
      await chooseGodot(onOpenEngineSettings, onClose);
      fireEvent.click(within(screen.getByTestId('engine-missing')).getByRole('button', { name: en['game.wizard.engineLocate'] }));
      expect(onOpenEngineSettings).toHaveBeenCalledOnce();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(JSON.parse(localStorage.getItem('pixo:new-game-draft.v3')!)).toMatchObject({ templateId: 'godot4-2d', title: 'Hollow Fox' });
    });

    it('keeps Create disabled on a restored review whose engine is missing', async () => {
      vi.mocked(fetchGameTemplates).mockResolvedValue(machine(false));
      seedReview('godot4-2d');
      render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
      await screen.findByTestId('wizard-step-review');
      await waitFor(() => expect(screen.getByText(en['game.wizard.problem.engine'])).toBeTruthy());
      expect(nextButton().disabled).toBe(true);
      expect(screen.getByTestId('what-happens-next').textContent).toContain(en['game.wizard.nextEngineMissing'].replace('{tool}', 'Godot'));
      expect(createGameFromTemplate).not.toHaveBeenCalled();
    });
  });

  it('says on review where the project goes, which engine, and that planning and approval come first', async () => {
    await open();
    await completeWizard();
    await chooseParentAndName();
    const next = screen.getByTestId('what-happens-next');
    expect(next.textContent).toContain(en['game.wizard.nextFolder'].replace('{path}', 'C:\\Games\\tiny-game'));
    expect(next.textContent).toContain(en['game.wizard.nextEngine'].replace('{engine}', 'Phaser 3 · 2D'));
    expect(next.textContent).toContain(en['game.wizard.nextPlan']);
    expect(next.textContent).toContain(en['game.wizard.nextApprove']);
    expect(screen.getByRole('button', { name: en['game.wizard.createAndPlan'] })).toBeTruthy();
    // Without the first turn, planning starts with the user's first message.
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(en['game.wizard.kickoff']) }));
    expect(next.textContent).toContain(en['game.wizard.nextPlanLater']);
    expect(screen.getByRole('button', { name: en['game.create'] })).toBeTruthy();
  });

  it('starts from an idea typed on Home: it seeds the pitch and is sent word for word', async () => {
    vi.mocked(createGameFromTemplate).mockResolvedValue(created);
    vi.mocked(uploadReferences).mockResolvedValue({ paths: ['art/references/01-cave.png'], failed: 0 });
    vi.mocked(saveGameSetup).mockResolvedValue({ setup: null, missingSteps: [] });
    URL.createObjectURL = vi.fn(() => 'blob:cave');
    URL.revokeObjectURL = vi.fn();
    const file = new File(['png'], 'cave.png', { type: 'image/png' });
    const onCreated = vi.fn();
    render(<NewGameDialog initialPrompt="  A fox looks for its family in a drowned city  " initialFiles={[file]} onClose={vi.fn()} onCreated={onCreated} />);
    await screen.findByTestId('wizard-step-size');
    fireEvent.click(screen.getByRole('radio', { name: /^Crafted/ }));
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-concept');
    // The pitch sits under More settings, opened because the idea filled it in.
    expect(screen.getByTestId('concept-more').getAttribute('data-open')).toBe('true');
    expect((screen.getByLabelText(/^One-line pitch/) as HTMLTextAreaElement).value).toBe('A fox looks for its family in a drowned city');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await completeWizard();
    expect(screen.getByText(en['game.wizard.firstMessage'])).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /Start planning/ })).toBeNull();
    await chooseParentAndName();
    fireEvent.click(screen.getByRole('button', { name: 'Create and start planning' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(uploadReferences).toHaveBeenCalledWith('game-id', [expect.objectContaining({ file })]);
    expect(sessionStorage.getItem('pixo:auto-send-prompt:game-id')).toBe('A fox looks for its family in a drowned city');
  });

  it('asks nothing about stores, systems or price, and offers Steam only to a long project', async () => {
    await open();
    expect(screen.queryByTestId('wizard-step-release')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Steam/ })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /^Long project/ }));
    openMore();
    const steam = screen.getByRole('checkbox', { name: new RegExp(en['game.wizard.steamLater']) }) as HTMLInputElement;
    fireEvent.click(steam);
    expect(steam.checked).toBe(true);
    // A smaller game folds the option away, and does not store it.
    fireEvent.click(screen.getByRole('radio', { name: /^Quick play/ }));
    expect(screen.getByTestId('size-long-options').getAttribute('aria-hidden')).toBe('true');
    for (const removed of ['Where you\'ll sell it', 'Steam App ID', 'Price', 'First milestone', 'Systems']) {
      expect(screen.queryByText(new RegExp(removed))).toBeNull();
    }
  });

  it('offers a way out for a project that already exists elsewhere', async () => {
    const onOpenFolder = vi.fn();
    const onClose = vi.fn();
    render(<NewGameDialog onOpenFolder={onOpenFolder} onClose={onClose} onCreated={vi.fn()} />);
    await answerToEngine();
    fireEvent.click(screen.getByRole('button', { name: en['game.wizard.existingProjectOpen'] }));
    expect(onOpenFolder).toHaveBeenCalledOnce();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('picks a template by keyboard, previews the target, and creates with the signed picker parent', async () => {
    vi.mocked(createGameFromTemplate).mockResolvedValue(created);
    const onCreated = await open();
    await answerToEngine('2.5D');
    const phaser = screen.getByRole('radio', { name: /Phaser/ });
    expect(phaser.getAttribute('aria-checked')).toBe('true');
    expect(phaser.tabIndex).toBe(0);
    fireEvent.keyDown(phaser, { key: 'ArrowRight' });
    const three = screen.getByRole('radio', { name: /Three/ });
    expect(three.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(three);
    expect(phaser.tabIndex).toBe(-1);

    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-review');
    await chooseParentAndName();
    expect(screen.getByTestId('new-game-target').textContent).toBe('C:\\Games\\tiny-game');
    expect(checkGameTarget).toHaveBeenLastCalledWith({ parentDir: 'C:\\Games', name: 'tiny-game' }, pickerToken, expect.anything());

    fireEvent.click(screen.getByRole('button', { name: 'Create and start planning' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({
      ok: true, projectId: 'game-id', conversationId: 'conversation-id', entryFile: 'index.html',
    }));
    expect(createGameFromTemplate).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'threejs-vite', parentDir: 'C:\\Games', name: 'tiny-game',
    }), pickerToken);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows a rejected creation without opening a project', async () => {
    seedReview();
    vi.mocked(createGameFromTemplate).mockRejectedValue(new Error('disk full'));
    const onCreated = await open();
    await chooseParentAndName();
    fireEvent.click(screen.getByRole('button', { name: 'Create game' }));
    expect((await screen.findByRole('alert')).textContent).toBe(en['game.createFailed']);
    expect(screen.getByText('disk full').closest('details')?.open).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('explains invalid names inline and never submits them', async () => {
    seedReview();
    await open();
    const input = screen.getByLabelText('Folder name');
    fireEvent.change(input, { target: { value: 'bad:name' } });
    expect(screen.getByText(en['game.dialog.nameCharacters'])).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: 'con' } });
    expect(screen.getByText(en['game.dialog.nameReserved'].replace('{name}', 'con'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create game' }));
    expect(createGameFromTemplate).not.toHaveBeenCalled();
    expect(checkGameTarget).not.toHaveBeenCalled();
    // Clearing the field goes back to following the title rather than to an error.
    fireEvent.change(input, { target: { value: '' } });
    expect((input as HTMLInputElement).placeholder).toBe('my-game');
    expect(screen.queryByText(en['game.dialog.nameEmpty'])).toBeNull();
  });

  it('reports an existing folder from the preflight on the name field', async () => {
    seedReview();
    vi.mocked(checkGameTarget).mockResolvedValue({ status: 'exists', target: 'C:\\Games\\tiny-game' });
    await open();
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'tiny-game' } });
    fireEvent.click(screen.getByRole('button', { name: /Browse/ }));
    expect(await screen.findByText(en['game.dialog.nameExists'])).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create game' }));
    expect(createGameFromTemplate).not.toHaveBeenCalled();
  });

  it('accepts a typed parent in the browser, prefilled from a configured project location', async () => {
    seedReview();
    vi.mocked(isOpenPixoHostAvailable).mockReturnValue(false);
    vi.mocked(fetchProjectLocations).mockResolvedValue([
      { id: 'default', name: 'OpenPixo projects', path: 'Z:\\builtin', builtIn: true },
      { id: 'games', name: 'Games', path: 'D:\\Games' },
    ]);
    await open();
    const parent = screen.getByLabelText('Location') as HTMLInputElement;
    await waitFor(() => expect(parent.value).toBe('D:\\Games'));
    expect(screen.getByText(en['game.dialog.locationSuggested'])).toBeTruthy();
    fireEvent.change(parent, { target: { value: 'games' } });
    expect(screen.getByText(en['game.dialog.locationRelative'])).toBeTruthy();
    vi.mocked(checkGameTarget).mockResolvedValue({ status: 'picker-required', message: 'token missing' });
    fireEvent.change(parent, { target: { value: 'E:\\Elsewhere\\' } });
    expect(screen.getByTestId('new-game-target').textContent).toBe('E:\\Elsewhere\\my-game');
    expect(await screen.findByText(en['game.dialog.locationPicker'])).toBeTruthy();
    expect(checkGameTarget).toHaveBeenLastCalledWith({ parentDir: 'E:\\Elsewhere\\', name: 'my-game' }, undefined, expect.anything());
  });

  it('keeps the form usable while the browser folder picker is pending, and can stop waiting', async () => {
    seedReview();
    vi.mocked(isOpenPixoHostAvailable).mockReturnValue(false);
    const { pickLocalFolderPath } = await import('../../src/state/projects');
    let resolvePick: (value: string | null) => void = () => {};
    vi.mocked(pickLocalFolderPath).mockImplementation(() => new Promise(resolve => { resolvePick = resolve; }));
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Browse/ }));
    expect(await screen.findByText(en['game.dialog.pickerWaiting'])).toBeTruthy();
    expect((screen.getByLabelText('Folder name') as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: en['game.dialog.pickerStop'] }));
    expect(screen.queryByText(en['game.dialog.pickerWaiting'])).toBeNull();
    resolvePick('C:\\Late');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((screen.getByLabelText('Location') as HTMLInputElement).value).toBe('');
  });
});

describe('new game target helpers', () => {
  it('previews in the parent separator style and keeps bare roots', () => {
    expect(previewGameTarget('C:\\Games\\\\', 'g')).toEqual({ parent: 'C:\\Games\\', name: 'g' });
    expect(previewGameTarget('C:\\', 'g')).toEqual({ parent: 'C:\\', name: 'g' });
    expect(previewGameTarget('/home/me/games/', 'g')).toEqual({ parent: '/home/me/games/', name: 'g' });
    expect(previewGameTarget('/', 'g')).toEqual({ parent: '/', name: 'g' });
  });

  it('recognises absolute paths, token expiry, and template labels', () => {
    expect(isAbsoluteFolderPath('C:\\x')).toBe(true);
    expect(isAbsoluteFolderPath('\\\\server\\share')).toBe(true);
    expect(isAbsoluteFolderPath('games')).toBe(false);
    expect(isAbsoluteFolderPath('C:games')).toBe(false);
    expect(pickerTokenExpiry('n~2026-01-01T00:00:00.000Z~s')).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(pickerTokenExpiry('garbage')).toBeNull();
    expect(splitTemplateName('Godot 4 · 3D')).toEqual({ engine: 'Godot 4', dimension: '3D' });
    expect(splitTemplateName('Custom')).toEqual({ engine: 'Custom', dimension: null });
  });

  it('shares the daemon folder-name rule', () => {
    expect(gameFolderNameProblem('my-game')).toBeNull();
    expect(gameFolderNameProblem('a\\b')).toBe('characters');
    expect(gameFolderNameProblem('a/b')).toBe('characters');
    expect(gameFolderNameProblem('a..b')).toBe('dots');
    expect(gameFolderNameProblem('game.')).toBe('trailing');
    expect(gameFolderNameProblem('LPT1.txt')).toBe('reserved');
  });
});

it('authorizes the explicit default-folder checkbox without opening the picker', async () => {
  const parentDir = 'C:\\Documents\\OpenPixo Games';
  vi.mocked(fetchGameTemplates).mockResolvedValue({ templates: [sampleTemplate], defaultParentDir: parentDir });
  vi.mocked(checkGameTarget).mockImplementation(async (_input, token) => token ? { status: 'available' } : { status: 'picker-required' });
  vi.mocked(authorizeHostGameParent).mockResolvedValue({ ok: true, baseDir: parentDir, token: pickerToken });
  vi.mocked(createGameFromTemplate).mockResolvedValue(created);
  seedReview(sampleTemplate.id);
  render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
  await screen.findByDisplayValue(parentDir);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Create this folder' }));
  await waitFor(() => expect(authorizeHostGameParent).toHaveBeenCalledWith(parentDir));
  await screen.findByText('Ready to create');
  fireEvent.click(screen.getByRole('button', { name: 'Create game' }));
  await waitFor(() => expect(createGameFromTemplate).toHaveBeenCalledWith(expect.objectContaining({ parentDir, createParent: true }), pickerToken));
  expect(pickHostWorkingDir).not.toHaveBeenCalled();
});


it('associates the create-folder text with its actual checkbox in both locales', async () => {
  for (const locale of ['en', 'zh-CN'] as const) {
    localeState.locale = locale;
    seedReview();
    render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByTestId('wizard-step-review');
    const checkbox = screen.getByRole('checkbox', { name: (locale === 'zh-CN' ? zhCN : en)['game.dialog.createParent'] }) as HTMLInputElement;
    expect(checkbox.id).not.toBe('');
    expect(checkbox.labels?.length).toBe(1);
    cleanup();
  }
});

describe('new game wizard', () => {
  beforeEach(() => { sessionStorage.clear(); });

  it('keeps Continue disabled until the screen has its required answers, and says what is missing', async () => {
    await open();
    expect(screen.getByTestId('wizard-step-size')).toBeTruthy();
    expect(nextButton().disabled).toBe(true);
    expect(screen.getByText(en['game.wizard.problem.scope'])).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
    fireEvent.click(screen.getByRole('radio', { name: /^Crafted/ }));
    fireEvent.click(nextButton());

    await screen.findByTestId('wizard-step-concept');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
    expect(nextButton().disabled).toBe(true);
    expect(screen.getByText(`${en['game.wizard.problem.title']} ${en['game.wizard.problem.genre']}`)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Game title/), { target: { value: 'Hollow Fox' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Platformer' }));
    // Who plays is on the concept screen, single player to start with.
    expect(screen.getByRole('checkbox', { name: en['game.wizard.player.single'] }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: en['game.wizard.player.single'] }));
    expect(nextButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: en['game.wizard.player.local-coop'] }));
    expect(nextButton().disabled).toBe(false);
    fireEvent.click(nextButton());

    await screen.findByTestId('wizard-step-view');
    expect(nextButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '2D side view' }));
    fireEvent.click(nextButton());

    await screen.findByTestId('wizard-step-art');
    expect(nextButton().disabled).toBe(true);
    fireEvent.click(await screen.findByRole('radio', { name: en['game.wizard.styleCustom'] }));
    expect(nextButton().disabled).toBe(true);
    expect(screen.getByText(en['game.wizard.problem.direction'])).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Direction/), { target: { value: 'Paper cut-outs' } });
    expect(nextButton().disabled).toBe(false);
    fireEvent.click(nextButton());

    // The engine screen opens with suggestions from the earlier answers, and still gates.
    await screen.findByTestId('wizard-step-setup');
    expect(screen.getByRole('radio', { name: /Phaser/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('radio', { name: /Three/ })).toBeNull();
    openMore();
    expect(screen.getByRole('radio', { name: /1920 × 1080/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'Keyboard' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keyboard' }));
    expect(nextButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Touch' }));
    fireEvent.click(screen.getByRole('radio', { name: /^Custom/ }));
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '600' } });
    expect(nextButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '800' } });
    expect(nextButton().disabled).toBe(false);
  });

  it('keeps every answer when going Back, and slides the screen in from the side it came from', async () => {
    await open();
    fireEvent.click(screen.getByRole('radio', { name: /^Quick play/ }));
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-concept');
    expect(screen.getByTestId('wizard-step-concept').getAttribute('data-direction')).toBe('forward');
    fireEvent.change(screen.getByLabelText(/^Game title/), { target: { value: 'Gears' } });
    fireEvent.click(screen.getByRole('radio', { name: en['game.wizard.genre.puzzle'] }));
    fireEvent.change(screen.getByLabelText(/^One-line pitch/), { target: { value: 'Tiny gears' } });
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-view');
    fireEvent.click(screen.getByRole('radio', { name: 'Menus and cards' }));
    fireEvent.click(nextButton());
    fireEvent.click(await screen.findByRole('radio', { name: styleCatalogue[0]!.title }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByTestId('wizard-step-view');
    expect(screen.getByTestId('wizard-step-view').getAttribute('data-direction')).toBe('back');
    expect(screen.getByRole('radio', { name: 'Menus and cards' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByTestId('wizard-step-concept');
    expect(screen.getByRole('radio', { name: en['game.wizard.genre.puzzle'] }).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByLabelText(/^One-line pitch/) as HTMLTextAreaElement).value).toBe('Tiny gears');
    await continueTo('art');
    expect((await screen.findByRole('radio', { name: styleCatalogue[0]!.title })).getAttribute('aria-checked')).toBe('true');
    // The chosen style brought no palette with it.
    expect(screen.queryByRole('button', { name: 'Remove #182238', hidden: true })).toBeNull();
    expect(screen.getByTestId('art-more').getAttribute('data-open')).toBe('false');
  });

  it('only offers the styles and engines that fit the perspective', async () => {
    await open();
    fireEvent.click(screen.getByRole('radio', { name: /^Crafted/ }));
    fireEvent.click(nextButton());
    fireEvent.change(await screen.findByLabelText(/^Game title/), { target: { value: 'Hollow Fox' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Platformer' }));
    fireEvent.click(nextButton());
    fireEvent.click(await screen.findByRole('radio', { name: '3D third person' }));
    fireEvent.click(nextButton());
    expect(await screen.findByRole('radio', { name: 'Low poly' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: styleCatalogue[0]!.title })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Low poly' }));
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-setup');
    expect(screen.getByRole('radio', { name: /Three/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('radio', { name: /Phaser/ })).toBeNull();
    // A 3D game has a render size, not a pixel grid to scale.
    openMore();
    expect(screen.queryByRole('radio', { name: en['game.wizard.scaling.pixel-perfect'] })).toBeNull();
  });

  it('keeps the draft when the dialog is closed and reopened', async () => {
    const onClose = vi.fn();
    const view = render(<NewGameDialog onClose={onClose} onCreated={vi.fn()} />);
    await screen.findByTestId('wizard-step-size');
    fireEvent.click(screen.getByRole('radio', { name: /^Crafted/ }));
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-concept');
    fireEvent.change(screen.getByLabelText(/^Game title/), { target: { value: 'Hollow Fox' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Shooter' }));
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-view');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    view.unmount();

    render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByTestId('wizard-step-view');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((await screen.findByRole('radio', { name: 'Shooter' })).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: en['game.wizard.startOver'] }));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: en['game.wizard.startOver'] }));
    await screen.findByTestId('wizard-step-size');
  });

  it('fills in the studio from the last game, the languages from the UI, and the size from the last game', async () => {
    localeState.locale = 'zh-CN';
    localStorage.setItem('pixo:new-game-studio', 'Tiny Lantern');
    localStorage.setItem('pixo:new-game-last-scope', 'long');
    render(<NewGameDialog onClose={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByTestId('wizard-step-size');
    expect(screen.getByRole('radio', { name: new RegExp(`^${zhCN['game.wizard.scope.long']}`) }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-concept');
    expect(screen.getByTestId('concept-more').getAttribute('data-open')).toBe('false');
    openMore(new RegExp(`^${zhCN['game.wizard.more']}`));
    expect((screen.getByLabelText(new RegExp(`^${zhCN['game.wizard.studio']}`)) as HTMLInputElement).value).toBe('Tiny Lantern');
    expect(screen.getByRole('checkbox', { name: '简体中文' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'English' }).getAttribute('aria-checked')).toBe('true');
  });

  it('continues with Enter on a chosen card', async () => {
    await open();
    const card = screen.getByRole('radio', { name: /^Quick play/ });
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });
    await screen.findByTestId('wizard-step-concept');
  });

  it('marks the frame for reduced motion when the system asks for it', async () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('matchMedia', matchMedia);
    try {
      await open();
      expect(document.querySelector('[data-motion]')?.getAttribute('data-motion')).toBe('reduced');
    } finally {
      vi.unstubAllGlobals();
    }
    cleanup();
    await open();
    expect(document.querySelector('[data-motion]')?.getAttribute('data-motion')).toBe('full');
  });

  it('creates with the setup, saves references, starts the first turn, and clears the draft', async () => {
    vi.mocked(createGameFromTemplate).mockResolvedValue(created);
    vi.mocked(uploadReferences).mockResolvedValue({ paths: ['art/references/01-cave.png'], failed: 0 });
    vi.mocked(saveGameSetup).mockResolvedValue({ setup: null, missingSteps: [] });
    URL.createObjectURL = vi.fn(() => 'blob:cave');
    URL.revokeObjectURL = vi.fn();
    const onCreated = await open();
    fireEvent.click(screen.getByRole('radio', { name: /^Quick play/ }));
    fireEvent.click(nextButton());
    fireEvent.change(await screen.findByLabelText(/^Game title/), { target: { value: 'Hollow Fox' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Platformer' }));
    fireEvent.click(nextButton());
    fireEvent.click(await screen.findByRole('radio', { name: '2D side view' }));
    fireEvent.click(nextButton());
    fireEvent.click(await screen.findByRole('radio', { name: styleCatalogue[0]!.title }));
    openMore(/^More settings: description/);
    const file = new File(['png'], 'cave.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Add images'), { target: { files: [file] } });
    expect(await screen.findByAltText('cave.png')).toBeTruthy();
    // Planning always shows style samples, so nobody is asked for one.
    expect(screen.queryByRole('checkbox', { name: /style sample/i })).toBeNull();
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-setup');
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-review');
    expect(screen.getByText(/1 image\(s\)/)).toBeTruthy();
    // A quick game plans in one short round, then the same steps: samples, a plan to approve, one part at a time.
    const flow = within(screen.getByTestId('what-happens-next-flow')).getAllByRole('listitem').map(item => item.textContent);
    expect(flow).toEqual([en['game.wizard.nextPlanQuick'], en['game.wizard.nextSamples'], en['game.wizard.nextApprove'], en['game.wizard.nextBuild']]);
    await chooseParentAndName();
    fireEvent.click(screen.getByRole('button', { name: 'Create and start planning' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(vi.mocked(createGameFromTemplate).mock.calls[0]![0].setup?.art).toEqual({ styleId: 'pixel-16-bit', pixelSize: 16 });
    expect(uploadReferences).toHaveBeenCalledWith('game-id', [expect.objectContaining({ file })]);
    expect(saveGameSetup).toHaveBeenCalledWith('game-id', expect.objectContaining({
      art: expect.objectContaining({ references: ['art/references/01-cave.png'] }),
    }));
    expect(sessionStorage.getItem('pixo:auto-send-first:game-id')).toBe('1');
    const kickoff = sessionStorage.getItem('pixo:auto-send-prompt:game-id') ?? '';
    expect(kickoff).toContain('Hollow Fox');
    expect(kickoff).toContain('Platformer game');
    expect(kickoff).toContain('share as a link');
    expect(kickoff).not.toContain('480×270');
    expect(localStorage.getItem('pixo:new-game-draft.v3')).toBeNull();
    // The next game opens on the same size.
    expect(localStorage.getItem('pixo:new-game-last-scope')).toBe('quick');
  });

  it('opens the project without a first turn when the user turns it off', async () => {
    vi.mocked(createGameFromTemplate).mockResolvedValue(created);
    seedReview();
    const onCreated = await open();
    const toggle = screen.getByRole('checkbox', { name: /Start planning with the agent right away/ }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    await chooseParentAndName();
    fireEvent.click(screen.getByRole('button', { name: 'Create game' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(sessionStorage.getItem('pixo:auto-send-first:game-id')).toBeNull();
    expect(uploadReferences).not.toHaveBeenCalled();
  });
});

describe('a first game', () => {
  const allTemplates: GameTemplateSummary[] = [
    { id: 'godot4-2d', name: 'Godot 4 · 2D', engine: 'godot', description: 'Starter' },
    { id: 'godot4-3d', name: 'Godot 4 · 3D', engine: 'godot', description: 'Starter' },
    { id: 'phaser3-vite', name: 'Phaser 3 · 2D', engine: 'phaser', description: 'Starter' },
    { id: 'threejs-vite', name: 'Three.js · 3D', engine: 'threejs', description: 'Cube' },
  ];
  beforeEach(() => {
    vi.mocked(fetchGameTemplates).mockResolvedValue({ templates: allTemplates });
  });

  it('asks once whether the user has made a game, and remembers the answer', async () => {
    vi.mocked(fetchGameExperience).mockResolvedValue(null);
    await open();
    expect(screen.getByTestId('wizard-step-experience')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('7');
    expect(nextButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /^First time/ }));
    expect(saveGameExperience).not.toHaveBeenCalled();
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-size');
    expect(saveGameExperience).toHaveBeenCalledWith('first');
    // Going back keeps the question on screen, answered.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect((await screen.findByRole('radio', { name: /^First time/ })).getAttribute('aria-checked')).toBe('true');
  });

  it('does not ask again once it is answered', async () => {
    vi.mocked(fetchGameExperience).mockResolvedValue('experienced');
    await open();
    expect(screen.getByTestId('wizard-step-size')).toBeTruthy();
    expect(screen.queryByTestId('wizard-step-experience')).toBeNull();
  });

  it('shows a first-timer only 2D views and the Phaser and Godot starters, each said plainly', async () => {
    vi.mocked(fetchGameExperience).mockResolvedValue('first');
    await open();
    fireEvent.click(screen.getByRole('radio', { name: /^Quick play/ }));
    fireEvent.click(nextButton());
    fireEvent.change(await screen.findByLabelText(/^Game title/), { target: { value: 'Fox' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Platformer' }));
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-view');
    expect(screen.getByText(en['game.wizard.stepHint.viewBeginner'])).toBeTruthy();
    const views = within(screen.getByRole('radiogroup')).getAllByRole('radio').map(radio => radio.getAttribute('aria-label'));
    expect(views).toEqual(['2D side view', '2D top-down', '2D angled (isometric)', 'Menus and cards']);
    // Each view says what it looks like on the card.
    expect(screen.getByRole('radio', { name: '2D side view' }).textContent).toContain(en['game.wizard.perspectiveHint.side-2d']);
    // Not shown at all, not merely disabled.
    expect(screen.queryByRole('radio', { name: '3D third person', hidden: true })).toBeNull();
    expect(screen.queryByRole('radio', { name: '2.5D', hidden: true })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '2D side view' }));
    fireEvent.click(nextButton());
    fireEvent.click(await screen.findByRole('radio', { name: styleCatalogue[0]!.title }));
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-setup');
    const starters = templateRadios();
    expect(starters.map(radio => radio.getAttribute('aria-label'))).toEqual(['Godot 4 · 2D', 'Phaser 3 · 2D']);
    const phaser = screen.getByRole('radio', { name: /Phaser/ });
    expect(phaser.getAttribute('aria-checked')).toBe('true');
    expect(phaser.textContent).toContain(en['game.wizard.engineMeans.web']);
    expect(phaser.textContent).toContain(en['game.wizard.engineAbout.phaser']);
    const godot = screen.getByRole('radio', { name: /Godot/ });
    expect(godot.textContent).toContain(en['game.wizard.engineMeans.godot']);
    expect(godot.textContent).toContain(en['game.wizard.engineAbout.godot']);
    // The starter's own file list is not what a first-timer reads.
    expect(godot.textContent).not.toContain('Starter');
    // The screen size and scaling keep their suggestion, unseen; only the controls are offered.
    openMore();
    expect(screen.queryByText(en['game.wizard.resolution'])).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Keyboard' }).getAttribute('aria-checked')).toBe('true');
  });

  it('tells a first-timer nothing about Steam builds, even for a long project', async () => {
    vi.mocked(fetchGameExperience).mockResolvedValue('first');
    await open();
    fireEvent.click(screen.getByRole('radio', { name: /^Long project/ }));
    openMore();
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(en['game.wizard.steamLater']) }));
    fireEvent.click(nextButton());
    fireEvent.change(await screen.findByLabelText(/^Game title/), { target: { value: 'Fox' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Platformer' }));
    fireEvent.click(nextButton());
    fireEvent.click(await screen.findByRole('radio', { name: '2D side view' }));
    fireEvent.click(nextButton());
    fireEvent.click(await screen.findByRole('radio', { name: styleCatalogue[0]!.title }));
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-setup');
    const text = screen.getByTestId('wizard-step-setup').textContent ?? '';
    for (const jargon of ['GodotSteam', 'Electron', 'Steamworks']) expect(text).not.toContain(jargon);
  });

  it('shows everyone else every view and starter', async () => {
    await open();
    fireEvent.click(screen.getByRole('radio', { name: /^Crafted/ }));
    fireEvent.click(nextButton());
    fireEvent.change(await screen.findByLabelText(/^Game title/), { target: { value: 'Fox' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Platformer' }));
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-view');
    expect(within(screen.getByRole('radiogroup')).getAllByRole('radio')).toHaveLength(8);
    fireEvent.click(screen.getByRole('radio', { name: '2.5D' }));
    fireEvent.click(nextButton());
    fireEvent.click(await screen.findByRole('radio', { name: styleCatalogue[0]!.title }));
    fireEvent.click(nextButton());
    await screen.findByTestId('wizard-step-setup');
    expect(templateRadios()).toHaveLength(4);
  });
});
