// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { gameSetupMissingSteps, parseGameProjectSetup, type GameTemplateSummary } from '@openpixo/contracts';
import {
  FEATURED_GENRES,
  GENRE_GROUPS,
  GENRE_VALUES,
  SAMPLE_TEMPLATE_ID,
  clearDraft,
  draftToSetup,
  emptyDraft,
  engineInstallHelp,
  folderNameFromTitle,
  furthestReachableStep,
  gameFolderName,
  integerScaleTo1080p,
  kickoffPrompt,
  loadDraft,
  markEdited,
  parseComparables,
  recommendedStarter,
  referencePath,
  resolutionChoices,
  runnableAlternative,
  saveDraft,
  setupToDraft,
  starterEngineMissing,
  startersFor,
  isBeginner,
  perspectivesFor,
  rememberScope,
  rememberedScope,
  stepComplete,
  stepProblems,
  templateDraftDefaults,
  withSuggestedSetup,
  wizardSteps,
  type WizardDraft,
} from '../../src/components/new-game/wizard-state';
import { en } from '../../src/i18n/locales/en';
import { zhCN } from '../../src/i18n/locales/zh-CN';

const create = { mode: 'create' as const, locationReady: true };

function filled(): WizardDraft {
  return {
    ...emptyDraft('godot4-2d'), title: 'Hollow Fox', scope: 'crafted', genre: 'metroidvania', perspective: 'side-2d',
    styleId: 'pixel-16-bit', palette: ['#182238'], pixelSize: 16,
    resolution: '480x270', scaling: 'pixel-perfect', controls: ['keyboard', 'gamepad'],
    // Answered by the user, not filled in by OpenPixo.
    edited: ['languages', 'display', 'controls'],
  };
}

const template = (id: string, name: string, engine: GameTemplateSummary['engine']): GameTemplateSummary =>
  ({ id, name, engine, description: '' });
const templates = [
  template('godot4-2d', 'Godot 4 · 2D', 'godot'), template('godot4-3d', 'Godot 4 · 3D', 'godot'),
  template('phaser3-vite', 'Phaser 3 · 2D', 'phaser'), template('threejs-vite', 'Three.js · 3D', 'threejs'),
  template(SAMPLE_TEMPLATE_ID, 'Sample: pixel platformer', 'phaser'),
];
const engine = (id: 'godot' | 'phaser' | 'threejs', available: boolean) =>
  ({ engine: id, name: id, templates: [], available, missingTools: [] });

afterEach(() => { localStorage.clear(); clearDraft(); });

describe('wizard gating', () => {
  it('asks the experience question once, only of a new game', () => {
    expect(wizardSteps('create', true)).toEqual(['experience', 'size', 'concept', 'view', 'art', 'setup', 'review']);
    expect(wizardSteps('create', false)).toEqual(['size', 'concept', 'view', 'art', 'setup', 'review']);
    expect(wizardSteps('edit', true)).toEqual(['size', 'concept', 'view', 'art', 'setup', 'review']);
    // No screen asks where the game is sold.
    expect(wizardSteps('create', true)).not.toContain('release');
    expect(stepProblems(emptyDraft(), 'experience', create)).toEqual(['experience']);
    expect(stepProblems(emptyDraft(), 'experience', { ...create, experience: 'first' })).toEqual([]);
  });

  it('asks every new game for its size', () => {
    expect(stepProblems(emptyDraft(), 'size', create)).toEqual(['scope']);
    expect(stepProblems({ ...emptyDraft(), scope: 'quick' }, 'size', create)).toEqual([]);
  });

  it('asks a new game for its title and genre, and for who plays', () => {
    const draft = emptyDraft();
    expect(stepProblems(draft, 'concept', create)).toEqual(['title', 'genre']);
    expect(stepProblems({ ...draft, title: 'x', genre: 'custom', genreCustom: '  ' }, 'concept', create)).toEqual(['genre']);
    expect(stepProblems({ ...draft, title: 'x', genre: 'puzzle', players: [], languages: [] }, 'concept', create)).toEqual(['players', 'languages']);
    // An existing project keeps its name.
    expect(stepProblems({ ...draft, genre: 'puzzle' }, 'concept', { mode: 'edit' })).toEqual([]);
    // Languages start as the UI's plus English (set by the dialog); a draft on its own starts in English.
    expect(draft.languages).toEqual(['en']);
    expect(draft.stores).toEqual([]);
  });

  it('asks a new game for its view, and holds a first-timer to the 2D ones', () => {
    expect(stepProblems(emptyDraft(), 'view', create)).toEqual(['perspective']);
    expect(stepProblems({ ...emptyDraft(), perspective: 'third-person-3d' }, 'view', create)).toEqual([]);
    const beginner = { ...create, experience: 'first' as const };
    expect(stepProblems({ ...emptyDraft(), perspective: 'third-person-3d' }, 'view', beginner)).toEqual(['perspective']);
    expect(stepProblems({ ...emptyDraft(), perspective: 'hd-2d' }, 'view', beginner)).toEqual(['perspective']);
    expect(stepProblems({ ...emptyDraft(), perspective: 'top-down-2d' }, 'view', beginner)).toEqual([]);
    expect(perspectivesFor(true)).toEqual(['side-2d', 'top-down-2d', 'isometric-2d', 'ui-2d']);
    expect(perspectivesFor(false)).toHaveLength(8);
    expect(isBeginner({ mode: 'edit', experience: 'first' })).toBe(false);
    expect(stepProblems({ ...emptyDraft(), perspective: '' }, 'view', { mode: 'edit' })).toEqual([]);
  });

  it('blocks art and tech until answered, and an engine is only asked of a new game', () => {
    const draft = emptyDraft();
    expect(stepProblems(draft, 'art', create)).toEqual(['style']);
    expect(stepProblems({ ...draft, styleId: 'custom' }, 'art', create)).toEqual(['direction']);
    expect(stepProblems({ ...draft, styleId: 'custom', direction: 'paper cut-outs' }, 'art', create)).toEqual([]);

    expect(stepProblems(draft, 'setup', create)).toEqual(['template', 'resolution', 'controls']);
    expect(stepProblems(draft, 'setup', { mode: 'edit' })).toEqual(['resolution', 'controls']);
    expect(stepProblems({ ...draft, templateId: 'x', resolution: 'custom', customWidth: '10', customHeight: '200', controls: ['touch'] }, 'setup', create))
      .toEqual(['resolution']);
    expect(stepProblems({ ...draft, templateId: 'x', resolution: 'custom', customWidth: '800', customHeight: '600', controls: ['touch'] }, 'setup', create))
      .toEqual([]);
    // A first-timer's restored draft may hold a starter they are no longer offered.
    expect(stepProblems({ ...filled(), templateId: 'threejs-vite' }, 'setup', { ...create, allowedTemplateIds: ['phaser3-vite', 'godot4-2d'] }))
      .toEqual(['template']);
  });

  it('only lets Create through when every screen, the folder and the location are ready', () => {
    expect(stepComplete(filled(), 'review', create)).toBe(true);
    expect(stepComplete(filled(), 'review', { mode: 'create', locationReady: false })).toBe(false);
    expect(stepProblems({ ...filled(), name: 'bad:name' }, 'review', create)).toEqual(['name']);
    expect(stepProblems({ ...filled(), controls: [] }, 'review', create)).toEqual(['controls']);
    expect(stepComplete({ ...filled(), title: '', name: '' }, 'review', { mode: 'edit' })).toBe(true);
  });

  it('never opens a screen past the first incomplete one', () => {
    const steps = wizardSteps('create');
    expect(furthestReachableStep(emptyDraft(), create, steps)).toBe(0);
    expect(furthestReachableStep({ ...filled(), genre: '' }, create, steps)).toBe(1);
    expect(furthestReachableStep({ ...filled(), perspective: '' }, create, steps)).toBe(2);
    expect(furthestReachableStep({ ...filled(), styleId: '' }, create, steps)).toBe(3);
    expect(furthestReachableStep({ ...filled(), controls: [] }, create, steps)).toBe(4);
    expect(furthestReachableStep(filled(), create, steps)).toBe(5);
  });
});

describe('folder name', () => {
  it('follows the title until the user names it, and keeps other scripts', () => {
    expect(gameFolderName({ title: 'Hollow Fox', name: '' })).toBe('Hollow Fox');
    expect(gameFolderName({ title: '沉城之狐', name: '' })).toBe('沉城之狐');
    expect(gameFolderName({ title: 'Hollow Fox', name: ' hollow-fox ' })).toBe('hollow-fox');
  });

  it('turns an awkward title into a usable folder rather than an error', () => {
    expect(folderNameFromTitle('Fox: The Return?')).toBe('Fox The Return');
    expect(folderNameFromTitle('Fox...')).toBe('Fox');
    expect(folderNameFromTitle('CON')).toBe('my-game');
    expect(folderNameFromTitle('   ')).toBe('my-game');
  });
});

describe('starters', () => {
  it('offers only what fits the perspective, and never the finished sample unprompted', () => {
    const ids = (perspective: WizardDraft['perspective'], templateId = '') => startersFor({ perspective, templateId }, templates).map(item => item.id);
    expect(ids('side-2d')).toEqual(['godot4-2d', 'phaser3-vite']);
    expect(ids('first-person-3d')).toEqual(['godot4-3d', 'threejs-vite']);
    expect(ids('hd-2d')).toEqual(['godot4-2d', 'godot4-3d', 'phaser3-vite', 'threejs-vite']);
    expect(ids('side-2d', SAMPLE_TEMPLATE_ID)).toContain(SAMPLE_TEMPLATE_ID);
  });

  it('offers a first-timer only the 2D Phaser and Godot starters, whatever the view', () => {
    const ids = (perspective: WizardDraft['perspective']) => startersFor({ perspective, templateId: '' }, templates, true).map(item => item.id);
    expect(ids('side-2d')).toEqual(['godot4-2d', 'phaser3-vite']);
    expect(ids('third-person-3d')).toEqual(['godot4-2d', 'phaser3-vite']);
    expect(recommendedStarter({ ...base(), perspective: 'side-2d' }, [...templates, template('cocos-2d', 'Cocos · 2D', 'cocos-creator')],
      [engine('godot', true), engine('phaser', true)], true)).toBe('phaser3-vite');
  });

  const base = () => ({ perspective: 'side-2d' as const, templateId: '', stores: [] as WizardDraft['stores'], scope: 'quick' as const, steamLater: false });

  it('recommends a web engine first, and native exports for a long project meant for Steam', () => {
    const ready = [engine('godot', true), engine('phaser', true)];
    expect(recommendedStarter(base(), templates, ready)).toBe('phaser3-vite');
    expect(recommendedStarter({ ...base(), scope: 'crafted' }, templates, ready)).toBe('phaser3-vite');
    expect(recommendedStarter({ ...base(), scope: 'long', steamLater: true }, templates, ready)).toBe('godot4-2d');
    // An older setup that sells on Steam still favours native exports.
    expect(recommendedStarter({ ...base(), stores: ['steam'] }, templates, ready)).toBe('godot4-2d');
  });

  it('does not recommend an engine this computer cannot run when another one fits', () => {
    const steam = { ...base(), scope: 'long' as const, steamLater: true };
    expect(recommendedStarter(steam, templates, [engine('godot', false), engine('phaser', true)])).toBe('phaser3-vite');
    expect(recommendedStarter(base(), templates, [engine('godot', true), engine('phaser', false)])).toBe('godot4-2d');
  });

  it('still names an engine when none runs, or the check failed', () => {
    const base = { perspective: 'side-2d' as const, templateId: '', stores: ['steam' as const], scope: '' as const, steamLater: false };
    expect(recommendedStarter(base, templates, [engine('godot', false), engine('phaser', true)])).toBe('phaser3-vite');
    // Nothing runnable: still name the right engine, and the card says it needs installing.
    expect(recommendedStarter(base, templates, [engine('godot', false), engine('phaser', false)])).toBe('godot4-2d');
    // The machine check failed: assume nothing about it.
    expect(recommendedStarter(base, templates, undefined)).toBe('godot4-2d');
  });
});

describe('an engine this computer does not have', () => {
  const godotMissing = { ...engine('godot', false), name: 'Godot', missingTools: ['godot'] };
  const machine = [godotMissing, engine('phaser', true), engine('threejs', true)];

  it('is found only for a chosen starter the computer reported missing', () => {
    expect(starterEngineMissing('godot4-2d', templates, machine)).toBe(godotMissing);
    expect(starterEngineMissing('phaser3-vite', templates, machine)).toBeNull();
    expect(starterEngineMissing('', templates, machine)).toBeNull();
    // An older daemon or a failed check blocks nothing.
    expect(starterEngineMissing('godot4-2d', templates, undefined)).toBeNull();
    // The finished sample stays one click.
    expect(starterEngineMissing(SAMPLE_TEMPLATE_ID, templates, [engine('phaser', false)])).toBeNull();
  });

  it('keeps the engine step and Create closed until it is installed or switched', () => {
    const draft = filled();
    const missing = { ...create, engineMissing: true };
    expect(stepProblems(draft, 'setup', missing)).toEqual(['engine']);
    expect(stepProblems(draft, 'review', missing)).toEqual(['engine']);
    expect(stepComplete(draft, 'review', missing)).toBe(false);
    expect(furthestReachableStep(draft, missing)).toBe(4);
    // No starter yet is a different problem, and an existing project picks no engine here.
    expect(stepProblems({ ...draft, templateId: '' }, 'setup', missing)).toEqual(['template']);
    expect(stepProblems(draft, 'setup', { mode: 'edit', engineMissing: true })).toEqual([]);
  });

  it('offers a starter that runs here, for the same perspective', () => {
    const draft = { stores: [] as WizardDraft['stores'], scope: 'long' as const, steamLater: true, perspective: 'side-2d' as const, templateId: 'godot4-2d' };
    expect(runnableAlternative(draft, templates, machine)?.id).toBe('phaser3-vite');
    expect(runnableAlternative({ ...draft, perspective: 'first-person-3d', templateId: 'godot4-3d' }, templates, machine)?.id).toBe('threejs-vite');
    expect(runnableAlternative(draft, templates, [godotMissing, engine('phaser', false)])).toBeNull();
  });

  it('points at the official download, and at Settings where the path can be set', () => {
    expect(engineInstallHelp(godotMissing)).toEqual({ tool: 'godot', downloadUrl: 'https://godotengine.org/download/windows/', configurable: true });
    expect(engineInstallHelp({ missingTools: ['npm'] })).toEqual({ tool: 'npm', downloadUrl: 'https://nodejs.org/en/download', configurable: false });
    expect(engineInstallHelp({ missingTools: [] })).toEqual({ tool: '', downloadUrl: null, configurable: false });
  });
});

describe('technical suggestions', () => {
  it('offers integer-scaled sizes for pixel art and display sizes otherwise', () => {
    expect(resolutionChoices({ ...emptyDraft(), perspective: 'side-2d', pixelSize: 16 })).toEqual(['320x180', '384x216', '480x270', '640x360']);
    expect(resolutionChoices({ ...emptyDraft(), perspective: 'third-person-3d' })).toEqual(['1280x720', '1920x1080', '2560x1440']);
    expect(resolutionChoices({ ...emptyDraft(), stores: ['steam'], os: ['steam-deck'] })).toContain('1280x800');
    expect(resolutionChoices({ ...emptyDraft(), stores: ['mobile'] })[0]).toBe('720x1280');
    // A size chosen earlier stays visible when later answers would hide it.
    expect(resolutionChoices({ ...emptyDraft(), pixelSize: 16, resolution: '1920x1080' })).toContain('1920x1080');
    expect(integerScaleTo1080p('480x270')).toBe(4);
    expect(integerScaleTo1080p('1280x720')).toBeNull();
  });

  it('suggests from earlier answers without overriding the user', () => {
    expect(withSuggestedSetup({ ...emptyDraft(), stores: ['mobile'] })).toMatchObject({ resolution: '720x1280', controls: ['touch'], scaling: 'fit' });
    expect(withSuggestedSetup({ ...emptyDraft(), perspective: 'side-2d', pixelSize: 16 }))
      .toMatchObject({ resolution: '480x270', controls: ['keyboard'], scaling: 'pixel-perfect' });
    // A long project meant for Steam is played with a gamepad too.
    expect(withSuggestedSetup({ ...emptyDraft(), perspective: 'side-2d', scope: 'long', steamLater: true }).controls).toEqual(['keyboard', 'gamepad']);
    expect(withSuggestedSetup({ ...emptyDraft(), perspective: 'side-2d', scope: 'crafted', steamLater: true }).controls).toEqual(['keyboard']);
    expect(withSuggestedSetup({ ...emptyDraft(), perspective: 'ui-2d' }).controls).toEqual(['keyboard', 'mouse']);
    expect(withSuggestedSetup({ ...emptyDraft(), perspective: 'ui-2d', os: ['steam-deck'] }).controls).toContain('gamepad');
    expect(withSuggestedSetup({ ...filled(), resolution: '1920x1080', scaling: 'stretch', controls: ['gamepad'] }))
      .toMatchObject({ resolution: '1920x1080', scaling: 'stretch', controls: ['gamepad'] });
    expect(withSuggestedSetup(filled(), 'phaser3-vite').templateId).toBe('phaser3-vite');
  });
});

describe('wizard answers', () => {
  it('starts the planning turn unless the user turns it off', () => {
    expect(emptyDraft().kickoff).toBe(true);
    expect(templateDraftDefaults(SAMPLE_TEMPLATE_ID).kickoff).toBe(false);
  });

  it('produces the setup the daemon stores, valid and complete, with no release answers', () => {
    const setup = draftToSetup({ ...filled(), studio: ' Tiny Lantern ', pitch: ' Fox ', comparables: 'Hollow Knight， Ori', sample: true,
      artSource: 'mixed', languages: ['zh-Hans', 'en'] }, ['art/references/01-a.png']);
    expect(setup).toEqual({
      title: 'Hollow Fox', studio: 'Tiny Lantern', genre: 'metroidvania', perspective: 'side-2d', pitch: 'Fox',
      comparables: ['Hollow Knight', 'Ori'], players: ['single'], scope: 'crafted',
      release: { languages: ['zh-Hans', 'en'] },
      art: { source: 'mixed', styleId: 'pixel-16-bit', palette: ['#182238'], pixelSize: 16, references: ['art/references/01-a.png'], sample: true },
      display: { width: 480, height: 270, scaling: 'pixel-perfect' }, controls: ['keyboard', 'gamepad'],
    });
    expect(parseGameProjectSetup(setup).ok).toBe(true);
    // No store and no platform, and still not unfinished.
    expect(gameSetupMissingSteps(setup)).toEqual([]);
    // A written direction without a catalogue style is stored as direction only.
    expect(draftToSetup({ ...filled(), styleId: 'custom', direction: 'paper' }).art).toEqual({ direction: 'paper', palette: ['#182238'], pixelSize: 16 });
  });

  /* 2026-11-10 beginner audit: hidden defaults reached the agent as the user's choices. */
  it('marks languages, screen size and controls the user never changed as suggested', () => {
    const untouched = withSuggestedSetup({ ...filled(), resolution: '', controls: [], edited: [], scope: 'long', steamLater: true });
    expect(draftToSetup(untouched).suggested).toEqual(['languages', 'display', 'controls']);
    let draft = markEdited(untouched, { controls: ['keyboard'] });
    draft = markEdited(draft, { customWidth: '800' });
    expect(draftToSetup(draft).suggested).toEqual(['languages']);
    // Edits elsewhere mark nothing.
    expect(markEdited(untouched, { title: 'x' }).edited).toEqual([]);
    // An existing setup opened for editing keeps what was suggested and what was chosen.
    const stored = draftToSetup(untouched);
    expect(draftToSetup(setupToDraft(stored))).toEqual(stored);
  });

  it('keeps the Steam answer only for a long project', () => {
    expect(draftToSetup({ ...filled(), scope: 'long', steamLater: true }).release).toEqual({ languages: ['en'], steamLater: true });
    expect(draftToSetup({ ...filled(), scope: 'quick', steamLater: true }).release).toEqual({ languages: ['en'] });
  });

  it("carries an older setup's release answers through an edit untouched", () => {
    const older = { genre: 'platformer', players: ['single' as const], platforms: ['desktop' as const],
      release: { stores: ['steam' as const], os: ['windows' as const, 'steam-deck' as const], steamAppId: '480', steamFeatures: ['achievements' as const],
        milestone: 'demo' as const, playtime: '5-15h' as const, price: '10-20' as const, languages: ['en' as const] },
      art: { styleId: 'pixel-16-bit' }, display: { width: 640, height: 360, scaling: 'fit' as const }, controls: ['keyboard' as const] };
    expect(draftToSetup(setupToDraft(older))).toEqual(older);
    // Platforms stored without stores survive too.
    const platformsOnly = { genre: 'puzzle', platforms: ['desktop' as const], art: { direction: 'paper' }, display: { width: 640, height: 360, scaling: 'fit' as const }, controls: ['mouse' as const] };
    expect(draftToSetup(setupToDraft(platformsOnly))).toEqual({ ...platformsOnly, players: ['single'], release: { languages: ['en'] } });
  });

  it('caps similar games at the setup limit', () => {
    expect(parseComparables('a, b、c；d')).toEqual(['a', 'b', 'c']);
    expect(parseComparables('  ')).toEqual([]);
  });

  it('round-trips a stored setup back into the wizard', () => {
    const setup = draftToSetup({ ...filled(), genre: 'custom', genreCustom: 'rhythm fighter', resolution: 'custom', customWidth: '800', customHeight: '600',
      comparables: 'Hollow Knight, Ori', artSource: 'own', scope: 'long', steamLater: true });
    const draft = setupToDraft(setup);
    expect(draft).toMatchObject({ genre: 'custom', genreCustom: 'rhythm fighter', resolution: 'custom', customWidth: '800', customHeight: '600', scope: 'long', steamLater: true, artSource: 'own' });
    expect(draftToSetup(draft)).toEqual(setup);
    expect(setupToDraft(draftToSetup(filled())).genre).toBe('metroidvania');
  });

  it('reads a setup from before the size question without inventing anything', () => {
    expect(setupToDraft({ genre: 'puzzle', platforms: ['web', 'mobile'] })).toMatchObject({ genre: 'puzzle', scope: '', stores: [], platforms: ['web', 'mobile'], milestone: '' });
    // A project with no setup at all gets the same starting point as a new game.
    expect(setupToDraft(null)).toEqual(emptyDraft());
    expect(setupToDraft({ scope: 'long', release: { steamLater: true } })).toMatchObject({ scope: 'long', steamLater: true });
  });

  it('keeps the draft across closing and reloading, and forgets a broken or older one', () => {
    expect(loadDraft()).toBeNull();
    saveDraft(filled(), 'art');
    expect(loadDraft()).toEqual({ draft: filled(), step: 'art' });
    localStorage.setItem('pixo:new-game-draft.v3', '{broken');
    expect(loadDraft()).toBeNull();
    saveDraft(filled(), 'view');
    clearDraft();
    expect(loadDraft()).toBeNull();
    // A draft from before the release screen went away is dropped, with its Steam defaults.
    localStorage.setItem('pixo:new-game-draft.v2', JSON.stringify({ ...filled(), stores: ['steam'] }));
    expect(loadDraft()).toBeNull();
    expect(localStorage.getItem('pixo:new-game-draft.v2')).toBeNull();
  });

  it('preselects the size chosen for the last game', () => {
    expect(rememberedScope()).toBe('');
    rememberScope('long');
    expect(rememberedScope()).toBe('long');
    rememberScope('');
    expect(rememberedScope()).toBe('long');
  });

  it('names reference files safely under art/references', () => {
    expect(referencePath(new File([''], 'My Cave (final).PNG'), 0)).toBe('art/references/01-my-cave-final.png');
    expect(referencePath(new File([''], '参考'), 4)).toBe('art/references/05-reference.png');
  });

  it('writes the first message in the UI language, in plain words', () => {
    const translate = (dict: typeof en) => (key: keyof typeof en, vars?: Record<string, string>) =>
      dict[key].replace(/\{(\w+)\}/g, (_, name: string) => vars?.[name] ?? '');
    const english = kickoffPrompt(translate(en), { ...filled(), controls: ['keyboard', 'gamepad'], sample: true });
    expect(english).toContain('Hollow Fox');
    expect(english).toContain(`${en['game.wizard.genre.metroidvania']} game`);
    expect(english).not.toContain('{');
    // The message reads as the user's own words: no screen sizes, scaling or control jargon,
    // and no sample request (planning always shows style samples).
    for (const jargon of ['480×270', 'resolution', 'scaling', 'Keyboard', 'Game setup', 'style sample']) expect(english).not.toContain(jargon);
    // The first turn plans; building waits for the user's approval.
    expect(english).toMatch(/plan Hollow Fox/i);
    expect(english).not.toMatch(/then build/i);
    const chinese = kickoffPrompt(translate(zhCN), filled());
    expect(chinese).toContain('规划');
    expect(chinese).toContain('银河恶魔城');
    expect(chinese).toContain('我刚才填的设置');
    for (const jargon of ['Game setup', '分辨率', '缩放', '风格样图']) expect(chinese).not.toContain(jargon);
    // A quick game asks to keep it short and shareable as a link.
    const quick = kickoffPrompt(translate(en), { ...filled(), scope: 'quick' });
    expect(quick).toMatch(/share as a link/);
    expect(quick).toMatch(/short/);
    expect(english).toMatch(/one step at a time/i);
    expect(kickoffPrompt(translate(zhCN), { ...filled(), scope: 'quick' })).toContain('小游戏');
  });

  it('stores no palette unless the user added colours, and still loads an older setup that has one', () => {
    const noColours = draftToSetup({ ...filled(), palette: [] });
    expect(noColours.art).toEqual({ styleId: 'pixel-16-bit', pixelSize: 16 });
    expect(noColours.art).not.toHaveProperty('palette');
    const older = { genre: 'platformer', art: { styleId: 'pixel-16-bit', palette: ['#182238', '#F0D8A8'], sample: true } };
    expect(setupToDraft(older)).toMatchObject({ palette: ['#182238', '#F0D8A8'], sample: true });
    expect(draftToSetup(setupToDraft(older)).art).toEqual(older.art);
  });

  it('features twelve genres that all exist, each a preset in a group', () => {
    expect(FEATURED_GENRES).toEqual(['platformer', 'metroidvania', 'survivors', 'roguelike', 'deckbuilder', 'puzzle',
      'tower-defense', 'life-sim', 'idle', 'shooter', 'turn-based-rpg', 'visual-novel']);
    const grouped = GENRE_GROUPS.flatMap(group => group.genres as readonly string[]);
    for (const genre of FEATURED_GENRES) {
      expect(GENRE_VALUES[genre]).toBeTruthy();
      expect(grouped).toContain(genre);
    }
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(Object.keys(GENRE_VALUES).sort()).toEqual([...grouped].sort());
    // Every genre, and "something else", explains itself in both languages.
    for (const genre of [...Object.keys(GENRE_VALUES), 'custom']) {
      expect(en[`game.wizard.genreHint.${genre}` as keyof typeof en]).toBeTruthy();
      expect(zhCN[`game.wizard.genreHint.${genre}` as keyof typeof zhCN]).toBeTruthy();
    }
  });

  it('stores the idle preset in English and reads it back as the same card', () => {
    const setup = draftToSetup({ ...filled(), genre: 'idle' });
    expect(setup.genre).toBe('idle / incremental clicker');
    expect(setupToDraft(setup)).toMatchObject({ genre: 'idle', genreCustom: '' });
    saveDraft({ ...filled(), genre: 'idle' }, 'concept');
    expect(loadDraft()?.draft.genre).toBe('idle');
  });

  it('keeps the stored English genre words when the labels are renamed', () => {
    // Renamed labels (卡牌, 解谜消除, 种田经营, ...) must not change what an older project stored.
    expect(GENRE_VALUES).toMatchObject({ roguelike: 'roguelike', deckbuilder: 'deckbuilder', puzzle: 'puzzle',
      'life-sim': 'farming and life sim', 'visual-novel': 'visual novel', survivors: 'survivors-like (bullet heaven)', metroidvania: 'metroidvania' });
    for (const genre of ['roguelike', 'deckbuilder', 'puzzle', 'life-sim', 'visual-novel', 'survivors'] as const) {
      expect(setupToDraft({ genre: GENRE_VALUES[genre] }).genre).toBe(genre);
    }
  });
});
