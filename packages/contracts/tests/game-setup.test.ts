import { describe, expect, it } from 'vitest';
import {
  composeOpenPixoGamePrompt,
  gamePlatformsForStores,
  gameSetupMissingSteps,
  gameSetupStepComplete,
  parseGameProjectSetup,
  parseGameResolution,
  renderGameSetupBlock,
  GAME_SETUP_BLOCK_HEADING,
} from '../src/index';

describe('game project setup contract', () => {
  it('normalizes text, colours and duplicates and drops empty answers', () => {
    expect(parseGameProjectSetup({
      genre: '  platformer ', pitch: '', platforms: ['web', 'web'], controls: [],
      art: { palette: ['#aabbcc', '#AABBCC'], direction: ' ' },
    })).toEqual({ ok: true, setup: { genre: 'platformer', platforms: ['web'], art: { palette: ['#AABBCC'] } } });
  });

  it('rejects unknown keys, values and unsafe reference paths', () => {
    for (const input of [
      { genre: 'x', extra: 1 }, { platforms: ['console'] }, { display: { width: 8, height: 8 } },
      { art: { palette: ['red'] } }, { art: { references: ['../secret.png'] } },
      { art: { references: ['C:/Users/me/a.png'] } }, { art: { references: ['/etc/a.png'] } },
    ]) {
      expect(parseGameProjectSetup(input).ok, JSON.stringify(input)).toBe(false);
    }
    expect(parseGameProjectSetup({ art: { references: ['art/references/01-cave.png'] } }).ok).toBe(true);
  });

  it('accepts the release answers and refuses anything outside their lists', () => {
    expect(parseGameProjectSetup({
      title: ' Hollow Fox ', studio: 'Tiny Lantern', perspective: 'side-2d', comparables: ['Hollow Knight'], players: ['single', 'single'],
      release: { stores: ['steam'], os: ['windows', 'steam-deck'], steamAppId: '480', steamFeatures: ['achievements'], milestone: 'demo', playtime: '5-15h', price: '10-20', languages: ['zh-Hans', 'en'] },
      art: { source: 'mixed' },
    })).toEqual({ ok: true, setup: {
      title: 'Hollow Fox', studio: 'Tiny Lantern', perspective: 'side-2d', comparables: ['Hollow Knight'], players: ['single'],
      release: { stores: ['steam'], os: ['windows', 'steam-deck'], steamAppId: '480', steamFeatures: ['achievements'], milestone: 'demo', playtime: '5-15h', price: '10-20', languages: ['zh-Hans', 'en'] },
      art: { source: 'mixed' },
    } });
    for (const input of [
      { perspective: 'vr' }, { release: { stores: ['epic'] } }, { release: { steamAppId: 'abc' } }, { release: { extra: 1 } },
      { release: { languages: ['klingon'] } }, { art: { source: 'stolen' } }, { comparables: ['a', 'b', 'c', 'd'] },
    ]) {
      expect(parseGameProjectSetup(input).ok, JSON.stringify(input)).toBe(false);
    }
  });

  it('keeps older and partial setups complete: release answers are never required of them', () => {
    expect(gameSetupMissingSteps({ genre: 'puzzle', platforms: ['web'], art: { styleId: 'a' },
      display: { width: 640, height: 360 }, controls: ['mouse'] })).toEqual([]);
  });

  it('counts a setup from today\'s dialog complete: a size, no stores or platforms', () => {
    const today = { genre: 'puzzle', scope: 'quick' as const, players: ['single' as const], release: { languages: ['zh-Hans' as const, 'en' as const] },
      art: { styleId: 'a' }, display: { width: 640, height: 360 }, controls: ['keyboard' as const] };
    expect(parseGameProjectSetup(today)).toEqual({ ok: true, setup: today });
    expect(gameSetupMissingSteps(today)).toEqual([]);
    expect(parseGameProjectSetup({ scope: 'huge' }).ok).toBe(false);
    expect(parseGameProjectSetup({ release: { steamLater: 'yes' } }).ok).toBe(false);
  });

  it('says the size, and mentions Steam only when the user said so', () => {
    const quick = renderGameSetupBlock({ genre: 'puzzle', scope: 'quick', release: { languages: ['zh-Hans', 'en'] } });
    expect(quick).toContain('- Size: a quick game: playable, and shareable as a link, after 2 to 4 hours');
    expect(quick).not.toContain('Steam');
    expect(quick).not.toContain('desktop wrapper');
    const long = renderGameSetupBlock({ genre: 'metroidvania', scope: 'long', release: { steamLater: true } });
    expect(long).toContain('- Size: a long project');
    expect(long).toContain('wants to release it on Steam one day');
    expect(long).toContain('Steam later: keep the door open');
    expect(long).toContain('Never invent an App ID');
    // A setup from before the size question keeps every release requirement it had.
    expect(renderGameSetupBlock({ release: { stores: ['steam'], steamLater: true } })).not.toContain('Steam later');
  });

  /*
   * 2026-11-10 beginner audit: a first-timer never saw languages, screen size or
   * controls, yet the agent was told "the user chose these", repeated 「键盘加手柄」 and
   * planned 「中英文切换」.
   */
  it('keeps defaults the user never saw apart from what they chose', () => {
    const setup = {
      genre: 'farming', scope: 'long' as const, release: { languages: ['zh-Hans' as const, 'en' as const], steamLater: true },
      display: { width: 480, height: 270, scaling: 'pixel-perfect' as const }, controls: ['keyboard' as const, 'gamepad' as const],
      suggested: ['languages' as const, 'display' as const, 'controls' as const],
    };
    expect(parseGameProjectSetup(setup).ok).toBe(true);
    const block = renderGameSetupBlock(setup, true, true);
    const [chosen, defaults] = block.split('OpenPixo filled these in');
    expect(chosen).toContain('- Genre: farming');
    expect(chosen).not.toContain('Languages at launch');
    expect(chosen).not.toContain('Controls:');
    expect(chosen).not.toContain('Base resolution');
    expect(defaults).toContain('- Languages at launch: Simplified Chinese, English');
    expect(defaults).toContain('- Controls: keyboard, gamepad');
    expect(defaults).toContain('- Pixel resolution: 480x270 world pixels on screen');
    expect(defaults).toContain('never present them as the user');
    // No multi-language work from a default.
    expect(block).not.toContain('use fonts that cover');
    // A user who chose two languages still gets the rule.
    expect(renderGameSetupBlock({ ...setup, suggested: ['display'] })).toContain('use fonts that cover Simplified Chinese, English');
    expect(renderGameSetupBlock({ ...setup, suggested: undefined })).not.toContain('OpenPixo filled these in');
  });

  it('maps stores to the builds they need', () => {
    expect(gamePlatformsForStores(['steam', 'itch'])).toEqual(['desktop']);
    expect(gamePlatformsForStores(['web', 'mobile'])).toEqual(['web', 'mobile']);
    expect(gamePlatformsForStores([])).toEqual([]);
  });

  it('turns a Steam target into what the build must support from the first scene', () => {
    const block = renderGameSetupBlock({
      title: 'Hollow Fox', studio: 'Tiny Lantern', perspective: 'side-2d', comparables: ['Hollow Knight'], players: ['single'],
      release: { stores: ['steam'], os: ['windows', 'steam-deck'], steamFeatures: ['achievements'], milestone: 'demo', playtime: '5-15h', price: '10-20', languages: ['zh-Hans', 'en'] },
    });
    expect(block).toContain('- Title: Hollow Fox, by Tiny Lantern');
    expect(block).toContain('- Perspective: 2D side view');
    expect(block).toContain('never to copy: Hollow Knight');
    expect(block).toContain('- Sells on: Steam');
    expect(block).toContain('- Desktop targets: Windows, Steam Deck');
    expect(block).toContain('a polished Steam demo');
    expect(block).toContain('Simplified Chinese, English');
    expect(block).toContain('string table');
    expect(block).toContain('per-user data folder');
    expect(block).toContain('desktop wrapper');
    expect(block).toContain('default controller setup must reach all content');
    expect(block).toContain('steam-release skill');
    expect(block).toContain('asset provenance');
    expect(block).toContain('Never invent an App ID');
  });

  it('asks nothing of a build that does not need it', () => {
    const web = renderGameSetupBlock({ title: 'Fox', release: { stores: ['web'], languages: ['en'] } });
    expect(web).toContain('window title');
    expect(web).not.toContain('desktop wrapper');
    expect(web).not.toContain('Steam');
    expect(web).not.toContain('string table');
    // Art the user made themselves has nothing to disclose.
    expect(renderGameSetupBlock({ release: { stores: ['steam'] }, art: { source: 'own' } })).not.toContain('generative AI');
    // A text-only provider has no shell to run the CLI or read a skill with.
    const textOnly = renderGameSetupBlock({ release: { stores: ['steam'] } }, false);
    expect(textOnly).not.toContain('asset provenance');
    expect(textOnly).not.toContain('steam-release');
    // A setup with only the old answers renders as it always did.
    expect(renderGameSetupBlock({ genre: 'shooter' })).not.toContain('From the first scene');
  });

  it('reports which steps still need answers', () => {
    expect(gameSetupMissingSteps(undefined)).toEqual(['basics', 'art', 'setup']);
    expect(gameSetupMissingSteps({ genre: 'puzzle' })).toEqual(['basics', 'art', 'setup']);
    expect(gameSetupMissingSteps({ genre: 'puzzle', platforms: ['mobile'], art: { direction: 'paper' } })).toEqual(['setup']);
    expect(gameSetupStepComplete({ art: { styleId: 'pixel-16-bit' } }, 'art')).toBe(true);
    expect(gameSetupStepComplete({ display: { width: 640, height: 360 } }, 'setup')).toBe(false);
    expect(gameSetupMissingSteps({ genre: 'puzzle', platforms: ['web'], art: { styleId: 'a' },
      display: { width: 640, height: 360 }, controls: ['mouse'] })).toEqual([]);
  });

  it('parses resolutions within the setup limits', () => {
    expect(parseGameResolution('640x360')).toEqual({ width: 640, height: 360 });
    expect(parseGameResolution(' 1920 × 1080 ')).toEqual({ width: 1920, height: 1080 });
    expect(parseGameResolution('10x10')).toBeNull();
    expect(parseGameResolution('wide')).toBeNull();
  });

  it('renders only the answered facts, after the art style and before media', () => {
    expect(renderGameSetupBlock(null)).toBe('');
    expect(renderGameSetupBlock({})).toBe('');
    const block = renderGameSetupBlock({ genre: 'shooter', display: { width: 720, height: 1280, scaling: 'fit' } });
    expect(block.startsWith(GAME_SETUP_BLOCK_HEADING)).toBe(true);
    expect(block).toContain('- Genre: shooter');
    expect(block).toContain('- Base resolution: 720x1280 (portrait), scaling: fit the window');
    expect(block).not.toContain('Palette');
    const prompt = composeOpenPixoGamePrompt({
      artStyle: { id: 'ink', title: 'Ink', prompt: 'ink', negativePrompt: '' },
      gameSetup: { genre: 'shooter' },
    });
    expect(prompt.indexOf('## Project art style')).toBeLessThan(prompt.indexOf(GAME_SETUP_BLOCK_HEADING));
  });
});
