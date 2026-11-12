import {
  GAME_ANIMATED_CHARACTER_HEADING,
  GAME_MEDIA_CONTRACT_HEADING,
  GAME_SMALL_ART_SET_HEADING,
  renderGameMediaGenerationContract as renderContractsGameMediaContract,
  type EngineProfile,
} from '@openpixo/contracts';
import { describe, expect, it } from 'vitest';

import { ASSET_OP_COMMANDS } from '../../src/assets/ops/asset-ops-cli.js';
import { IMAGE_MODELS } from '../../src/media/models.js';
import { connectedImageTools, gameMediaModelCatalog, renderGameMediaGenerationContract, usableMediaProviders } from '../../src/game/media-contract.js';
import { composeGameSystemPrompt } from '../../src/game/prompt.js';

// The game path returns before the legacy media contract, so it carries its
// own variant. Its text has one source in contracts; the daemon adds only its
// model catalogue. These checks keep the daemon game path and the API/BYOK game
// path on the same rules (spec: specs/current/openpixo-phase1-game-harness.md
// §3.2).

const PHASER_PROFILE: EngineProfile = {
  detectorVersion: 1,
  engine: 'phaser',
  engineVersion: '3.80.1',
  confidence: 'certain',
  evidence: ['package.json'],
  languages: ['TypeScript'],
  assetRoots: ['public/assets', 'src/assets'],
  importMetadata: 'none',
  commands: {
    build: { argv: ['npm', 'run', 'build'], cwd: '.', timeoutMs: 120_000 },
    run: { argv: ['npm', 'run', 'dev'], cwd: '.', timeoutMs: 60_000 },
  },
  tools: [{ id: 'npm', resolved: true, source: 'path' }],
  detectedAt: 0,
};

/** Everything but the `### Models` section, which only the daemon can fill. */
function withoutModelSection(block: string): string {
  return block.replace(/### Models\n[\s\S]*?(?=\n### )/, '');
}

describe('game media contract (daemon vs contracts)', () => {
  it('shares every rule except the daemon model catalogue', () => {
    const daemon = renderGameMediaGenerationContract(undefined, undefined, PHASER_PROFILE);
    const contracts = renderContractsGameMediaContract({ engineProfile: PHASER_PROFILE });
    expect(withoutModelSection(daemon)).toBe(withoutModelSection(contracts));
    expect(daemon).not.toBe(contracts);
  });

  it('carries the dispatcher, allowlist, polling and asset-root rules', () => {
    const block = renderGameMediaGenerationContract(undefined, undefined, PHASER_PROFILE);
    expect(block).toContain(GAME_MEDIA_CONTRACT_HEADING);
    expect(block).toContain('"$PIXO_NODE_BIN" "$PIXO_BIN" media generate');
    expect(block).toContain('media wait <taskId> --since <nextSince>');
    expect(block).toContain('`public/assets`, `src/assets`');
    expect(block).toContain('list every generated file path');
    for (const model of IMAGE_MODELS.slice(0, 3)) expect(block).toContain(`\`${model.id}\``);
    expect(block).toContain('error.nextStep');
    expect(block).not.toContain('新建一个图片项目');
  });

  // A hosted model spends credits, so it is offered only with an art budget that can
  // pay. Offering one without only sets it up to fail in front of the user.
  it('offers a hosted model to an agent only when the art budget can pay', () => {
    for (const catalog of [gameMediaModelCatalog(), gameMediaModelCatalog(['openpixo', 'codex-cli'])]) {
      expect(catalog.image).not.toContain('openpixo-image');
      expect(catalog.image).not.toContain('openpixo-image-edit');
      expect(catalog.defaultImageModel ?? '').not.toMatch(/^openpixo-/);
    }
    expect(renderGameMediaGenerationContract()).not.toContain('`openpixo-image');
  });

  it('adds the budget models after every own tool, which stay first and default', () => {
    const catalog = gameMediaModelCatalog(['codex-cli', 'openai'], true);
    expect(catalog.image.slice(-2)).toEqual(['openpixo-image', 'openpixo-image-edit']);
    expect(catalog.image.indexOf('codex-image')).toBeLessThan(catalog.image.indexOf('openpixo-image'));
    expect(catalog.defaultImageModel).toBe('codex-image');
    const keyOnly = gameMediaModelCatalog(['volcengine'], true);
    expect(keyOnly.defaultImageModel).toBe('doubao-seedream-3-0-t2i-250415');
  });

  it('with only credits, defaults to the text-to-image hosted model', () => {
    const catalog = gameMediaModelCatalog([], true);
    expect(catalog.image).toEqual(['openpixo-image', 'openpixo-image-edit']);
    expect(catalog.defaultImageModel).toBe('openpixo-image');
    expect(catalog.budgetImageModels).toEqual(['openpixo-image', 'openpixo-image-edit']);
  });

  it('states the budget rules and drops the no-image rule when the budget can pay', () => {
    const block = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: [], budgetImages: true });
    expect(block).toContain('- image: `openpixo-image`, `openpixo-image-edit`');
    expect(block).toContain('### Images paid from the art budget');
    expect(block).toContain('Only the user can set or raise the budget');
    expect(block).not.toContain('No image model can run right now');
    expect(block).toContain('otherwise `openpixo-image`');
    // The figures change with every image, so none of them may enter the cached prefix.
    expect(block).not.toMatch(/\d+ of \d+ credits/);
  });

  it('offers hosted audio under the right kinds only when the art budget can pay', () => {
    const paid = gameMediaModelCatalog(['elevenlabs'], true);
    expect(paid.audioMusic).toEqual(['openpixo-music']);
    expect(paid.audioSpeech).toEqual(['elevenlabs-v3', 'openpixo-voice']);
    expect(paid.audioSfx).toEqual(['elevenlabs-sfx', 'openpixo-sfx']);
    expect(paid.budgetAudioModels).toEqual(['openpixo-sfx', 'openpixo-voice', 'openpixo-music']);
    for (const catalog of [gameMediaModelCatalog(), gameMediaModelCatalog(['openpixo', 'elevenlabs']), gameMediaModelCatalog([], false)]) {
      expect([...catalog.audioMusic, ...catalog.audioSpeech, ...catalog.audioSfx].filter((id) => id.startsWith('openpixo-'))).toEqual([]);
      expect(catalog.budgetAudioModels).toBeUndefined();
    }
  });

  it('states the audio limits with a budget, keeps them out without one, and names no vendor', () => {
    const block = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: [], budgetImages: true });
    expect(block).toContain('- audio · sfx: `openpixo-sfx`');
    expect(block).toContain('- audio · speech: `openpixo-voice`');
    expect(block).toContain('- audio · music: `openpixo-music`');
    expect(block).toContain('### Audio paid from the art budget');
    for (const rule of ['up to 450 characters', 'up to 10 seconds', '`--voice <name>`', 'up to 300 characters', '10 to 300 characters', 'instrumental', 'cannot be set']) {
      expect(block).toContain(rule);
    }
    expect(block).not.toMatch(/\bfal\b|fal-ai|-fal\b|elevenlabs|minimax/i);
    const without = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: [] });
    expect(without).not.toContain('openpixo-sfx');
    expect(without).not.toContain('### Audio paid from the art budget');
  });

  it('states the 3D terms with a budget, keeps them out without one, and names no vendor', () => {
    const block = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: [], budgetImages: true });
    expect(block).toContain('- model3d: `openpixo-model3d`, `openpixo-model3d-draft`, `openpixo-model3d-high`');
    // Medium is the default; the other tiers are for when the user asks.
    expect(block).toContain('Use `openpixo-model3d`, the medium quality, unless the user asked for something else.');
    expect(block).toContain('`openpixo-model3d-draft` costs a third as much');
    expect(block).toContain('`openpixo-model3d-high` costs twice as much');
    expect(block).toContain('### 3D models paid from the art budget');
    expect(block).toContain('A track costs far more than the others and can take several minutes');
    expect(block).not.toMatch(/\bfal\b|fal-ai|-fal\b|fal\.media/i);
    expect(gameMediaModelCatalog([], true).budgetModel3dModels).toEqual(['openpixo-model3d', 'openpixo-model3d-draft', 'openpixo-model3d-high']);
    expect(gameMediaModelCatalog(['media-gateway'], false).budgetModel3dModels).toBeUndefined();
    const without = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: [] });
    expect(without).not.toContain('openpixo-model3d');
    expect(without).not.toContain('### 3D models paid from the art budget');
  });

  it('keeps the old behaviour with no budget, and no budget rules', () => {
    const block = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: [] });
    expect(block).toContain('No image model can run right now');
    expect(block).not.toContain('### Images paid from the art budget');
  });

  it('keeps a run default on a hosted model only when the budget offers it', () => {
    expect(renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: [], budgetImages: true }, { imageModel: 'openpixo-image' }))
      .toContain('- Image model: `openpixo-image`');
  });

  it('disabled media stays disabled, budget or not', () => {
    const block = renderGameMediaGenerationContract({ mode: 'disabled', budgetImages: true });
    expect(block).not.toContain('openpixo-image');
    expect(block).toContain('disabled for this run');
  });

  it('counts only image providers as an own image tool', () => {
    const provider = (over = {}) => ({ configured: false, source: 'unset', apiKeyTail: '', baseUrl: '', ...over });
    const config = { providers: { 'codex-cli': provider({ available: true, keyless: true }), elevenlabs: provider({ configured: true }), openpixo: provider({ configured: true }) } };
    expect(connectedImageTools(config as never)).toEqual(['codex-cli']);
    expect(connectedImageTools({ providers: { elevenlabs: provider({ configured: true }) } } as never)).toEqual([]);
  });

  it('offers only what can run: a Codex sign-in means Codex images, first', () => {
    const catalog = gameMediaModelCatalog(['codex-cli']);
    expect(catalog.image).toEqual(['codex-image']);
    expect(catalog.defaultImageModel).toBe('codex-image');
    expect(catalog.video).toEqual([]);
  });

  it('prefers the Codex sign-in over a key, as first-run setup does', () => {
    const catalog = gameMediaModelCatalog(['openai', 'codex-cli']);
    expect(catalog.image).toEqual(expect.arrayContaining(['gpt-image-2', 'dall-e-3', 'codex-image']));
    expect(catalog.defaultImageModel).toBe('codex-image');
  });

  it('with only a key, defaults to a model of that key that can start from text', () => {
    const catalog = gameMediaModelCatalog(['volcengine', 'media-gateway']);
    expect(catalog.defaultImageModel).toBe('doubao-seedream-3-0-t2i-250415');
    expect(catalog.image).toContain('flux-dev-gateway');
    expect(renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: ['volcengine', 'media-gateway'] }))
      .not.toMatch(/\bfal\b|fal-ai|-fal\b/i);
  });

  it('says plainly when this run cannot make images at all', () => {
    const block = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: [] });
    expect(block).toContain('- image: (none)');
    expect(block).toContain('No image model can run right now');
    expect(block).not.toContain('`gpt-image-2`');
  });

  it('drops a run default that cannot run in this run, and keeps one that can', () => {
    const defaults = { imageModel: 'gpt-image-2', videoModel: 'not-in-the-registry', speechVoice: 'nova' };
    const block = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: ['codex-cli'] }, defaults);
    expect(block).not.toContain('`gpt-image-2`');
    expect(block).toContain('- Video model: `not-in-the-registry`');
    expect(block).toContain('- Speech voice: `nova`');
    expect(renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: ['openai'] }, defaults))
      .toContain('- Image model: `gpt-image-2`');
    expect(renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: ['codex-cli'] }, { imageModel: 'openpixo-image' }))
      .not.toContain('`openpixo-image`');
  });

  describe('the image model the user picked in Settings', () => {
    it('becomes the default when it can run, ahead of the Codex sign-in', () => {
      const catalog = gameMediaModelCatalog(['codex-cli', 'openai'], false, 'gpt-image-2');
      expect(catalog.defaultImageModel).toBe('gpt-image-2');
      expect(catalog.defaultImageModelIsUserChoice).toBe(true);
      expect(catalog.unavailableImageChoice).toBeUndefined();
      const block = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: ['codex-cli', 'openai'] }, undefined, undefined, 'gpt-image-2');
      expect(block).toContain('otherwise `gpt-image-2`, the image model the user picked in Settings');
      expect(block).not.toContain('cannot run in this run');
    });

    it('falls back to automatic when it cannot run, and tells the agent what to say', () => {
      const catalog = gameMediaModelCatalog(['codex-cli'], false, 'gpt-image-2');
      expect(catalog.defaultImageModel).toBe('codex-image');
      expect(catalog.defaultImageModelIsUserChoice).toBeUndefined();
      expect(catalog.unavailableImageChoice).toEqual({ id: 'gpt-image-2', reason: 'not-connected' });
      const block = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: ['codex-cli'] }, undefined, undefined, 'gpt-image-2');
      expect(block).toContain('otherwise `codex-image`.');
      expect(block).toContain('The user picked `gpt-image-2` in Settings as the image model, but it cannot run in this run');
      expect(block).toContain('你在设置里选的生图模型现在没连上');
      // Codex is not signed in: same fallback.
      expect(gameMediaModelCatalog(['openai'], false, 'codex-image')).toMatchObject({
        defaultImageModel: 'gpt-image-2', unavailableImageChoice: { id: 'codex-image', reason: 'not-connected' },
      });
      expect(gameMediaModelCatalog(['openai'], false, 'retired-model').unavailableImageChoice).toEqual({ id: 'retired-model', reason: 'unknown-model' });
    });

    it('a hosted pick runs only through the art budget', () => {
      const without = gameMediaModelCatalog(['codex-cli'], false, 'openpixo-image');
      expect(without.image).not.toContain('openpixo-image');
      expect(without.defaultImageModel).toBe('codex-image');
      expect(without.unavailableImageChoice).toEqual({ id: 'openpixo-image', reason: 'needs-art-budget' });
      const withoutBlock = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: ['codex-cli'] }, undefined, undefined, 'openpixo-image');
      expect(withoutBlock).toContain('要先给这个项目设好美术预算');
      expect(withoutBlock).not.toContain('### Images paid from the art budget');

      const paid = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: ['codex-cli'], budgetImages: true }, undefined, undefined, 'openpixo-image');
      expect(paid).toContain('otherwise `openpixo-image`, the image model the user picked in Settings');
      expect(paid).toContain('The user picked `openpixo-image` in Settings as the image model, so it is the default');
      expect(paid).not.toContain('use those first');
      expect(paid).not.toMatch(/\bfal\b|fal-ai|-fal\b/i);
    });

    it('wins over a provider BYOK default, while a model the user names in chat still comes first', () => {
      const block = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: ['openai', 'senseaudio'] }, { imageModel: 'senseaudio-image-2.0-260319', speechVoice: 'nova' }, undefined, 'gpt-image-2');
      expect(block).not.toContain('- Image model: `senseaudio-image-2.0-260319`');
      expect(block).toContain('- Speech voice: `nova`');
      expect(block).toContain('Model choice: the one the user names, then the run default, otherwise `gpt-image-2`');
      // Automatic keeps the BYOK default as before.
      expect(renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: ['openai', 'senseaudio'] }, { imageModel: 'senseaudio-image-2.0-260319' }))
        .toContain('- Image model: `senseaudio-image-2.0-260319`');
    });

    it('with no image model at all, only the no-image rule speaks', () => {
      const block = renderGameMediaGenerationContract({ mode: 'enabled', usableProviders: [] }, undefined, undefined, 'gpt-image-2');
      expect(block).toContain('No image model can run right now');
      expect(block).not.toContain('cannot run in this run');
    });
  });

  it('reads what can run from the media config, the way recipes do', () => {
    const provider = (over = {}) => ({ configured: false, source: 'unset', apiKeyTail: '', baseUrl: '', ...over });
    const usable = usableMediaProviders({
      providers: {
        'codex-cli': provider({ available: true, keyless: true }),
        openai: provider({ configured: true }),
        'media-gateway': provider(),
        openpixo: provider({ configured: true }),
        bfl: provider({ configured: true }),
        'custom-image': provider({ baseUrl: 'http://127.0.0.1:9000' }),
      },
    });
    expect([...usable].sort()).toEqual(['codex-cli', 'custom-image', 'openai']);
    expect(usableMediaProviders({ providers: { 'codex-cli': provider({ available: false, keyless: true }) } })).toEqual([]);
  });

  // A moving character used to ship as one still image flipped left and right.
  it('asks for one framed sheet per animation state, with commands that exist', () => {
    const block = renderGameMediaGenerationContract(undefined, undefined, PHASER_PROFILE);
    const rule = block.slice(block.indexOf(GAME_ANIMATED_CHARACTER_HEADING), block.indexOf('### Wire it in'));
    expect(rule).toContain(GAME_ANIMATED_CHARACTER_HEADING);
    expect(rule).toContain('one image\nflipped left and right is not an animation');
    expect(rule).toContain('One sheet per state');
    expect(rule).toContain('`--sheet <C>x<R> --frames`');
    expect(rule).toContain('`--image`');
    expect(rule).toContain('name each moving character\'s states');
    // The host picks the shape and does the cut; the agent no longer slices or picks an aspect.
    expect(rule).not.toMatch(/--aspect|asset slice/);
    expect(rule).toContain('`summary.issues`');
    const ops = [...rule.matchAll(/`(?:"\$PIXO_NODE_BIN" "\$PIXO_BIN" )?asset ([a-z-]+)/g)].map(match => match[1]!);
    expect(ops).toEqual(expect.arrayContaining(['frames', 'pixelate', 'export-spritesheet']));
    for (const op of ops) expect(ASSET_OP_COMMANDS.has(op)).toBe(true);
    expect(rule).toMatch(/asset frames check/);
    expect(rule).toMatch(/asset frames\s+align/);
  });

  // A top-down Codex game (Sakura Nightfall) shipped four facing directions from
  // --sheet calls while an accepted 8-direction walk recipe sat in the list unused.
  it('walks a top-down character in eight directions with the accepted walk recipe', () => {
    const block = renderGameMediaGenerationContract(undefined, undefined, PHASER_PROFILE);
    const rule = block.slice(block.indexOf(GAME_ANIMATED_CHARACTER_HEADING), block.indexOf('### Wire it in'));
    expect(rule).toContain('top-down');
    expect(rule).toMatch(/eight\s+directions/);
    expect(rule).toContain('`sprite-walk-8dir`');
    expect(rule).toMatch(/character create <slug> --name <name> --description <text> --reference <design>/);
    expect(rule).toMatch(/recipe run sprite-walk-8dir --input character=<slug> --input frames=<4\|6\|8> --json --wait/);
    expect(rule).toMatch(/recipe adopt <runId> --candidate <id>/);
    expect(rule).toContain('Look at every row before adopting');
    // The walk's frames still go through the host's check and alignment.
    expect(rule).toMatch(/each direction[^.]*asset frames check/);
  });

  // A 64 px icon is billed as the full render, so a set of small art is one sheet, cut by the host.
  it('asks for one --sheet call for a set of small art', () => {
    const block = renderGameMediaGenerationContract(undefined, undefined, PHASER_PROFILE);
    const rule = block.slice(block.indexOf(GAME_SMALL_ART_SET_HEADING), block.indexOf(GAME_ANIMATED_CHARACTER_HEADING));
    expect(rule).toContain(GAME_SMALL_ART_SET_HEADING);
    expect(rule).toContain('costs as much as a full image');
    expect(rule).toContain('--sheet 3x2 --names coin,heart,key,gem,potion,bomb --size 64x64 --transparent');
    expect(rule).toContain('`file.pieces`');
    expect(rule).toContain('counts as one image on an art card');
    expect(rule).not.toMatch(/asset slice|--aspect \d/);
    expect(block).toContain('one call per asset or per set of small assets');
    expect(block).toContain('[--sheet <C>x<R> [--names a,b,...] [--frames]]');
    expect(block).toContain('`file.note`');
  });

  it('keeps disabled semantics', () => {
    const block = renderGameMediaGenerationContract({ mode: 'disabled' });
    expect(block).toContain('disabled for this run');
    expect(block).toBe(renderContractsGameMediaContract({ mediaExecution: { mode: 'disabled' } }));
  });

  it('reaches the daemon game path with the engine profile and verification block', () => {
    const prompt = composeGameSystemPrompt({
      baseDir: 'C:\\Games\\Phaser', engineProfile: PHASER_PROFILE ,
      mediaExecution: { mode: 'enabled', allowedModels: ['gpt-image-2'] },
    });
    expect(prompt).toContain('## Engine profile');
    expect(prompt).toContain('Phaser 3.80.1');
    expect(prompt).toContain(GAME_MEDIA_CONTRACT_HEADING);
    expect(prompt).toContain('Models allowed this run: `gpt-image-2`');
    expect(prompt).toContain('## Verification');
    expect(prompt).toContain('game verify');
    // The legacy design-project media contract stays off the game path.
    expect(prompt).not.toContain('## Media generation contract');

    const disabled = composeGameSystemPrompt({
      baseDir: 'C:\\Games\\Phaser' ,
      mediaExecution: { mode: 'disabled' },
    });
    expect(disabled).toContain('Host media generation is **disabled for this run**');
    expect(disabled).toContain('has not identified this project\'s engine');
  });
});
