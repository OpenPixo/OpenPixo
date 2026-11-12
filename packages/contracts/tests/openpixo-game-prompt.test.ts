import { PRODUCT_CLI_NAME } from '../src/product.js';
import { describe, expect, it } from 'vitest';
import type { EngineProfile } from '../src/api/game-project.js';
import type { ProjectArtStylePromptInput } from '../src/api/styles.js';
import { GAME_ART_DECISION_HEADING, renderArtBudgetTurnNote, renderGameMediaGenerationContract } from '../src/prompts/media-contract.js';
import { IMAGE_OUTPUT_MAX_EDGE } from '../src/api/media.js';
import {
  composeOpenPixoGamePrompt,
  GAME_ART_STYLE_BLOCK_HEADING,
  GAME_ENGINE_BLOCK_HEADING,
  GAME_MEDIA_CONTRACT_HEADING,
  GAME_RECIPES_BLOCK_HEADING,
  GAME_VERIFICATION_BLOCK_HEADING,
  renderGameRecipesBlock,
  renderGameArtStyleBlock,
} from '../src/prompts/openpixo-game.js';

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

const PIXEL_STYLE: ProjectArtStylePromptInput = {
  id: '16-bit-pixel',
  title: '16-bit pixel',
  prompt: 'Crisp pixel clusters with a limited palette.',
  negativePrompt: 'Blur, gradients, antialiasing.',
  palette: ['#243047', '#F8D080'],
  constraints: {
    pixelSize: 32,
    outline: 'One-pixel dark outline',
    background: 'transparent',
    recommendedResolution: '1024x1024',
  },
};

describe('OpenPixo imported game project prompt', () => {
  it('omits the art style block when the project has no style', () => {
    const prompt = composeOpenPixoGamePrompt({});
    expect(prompt).not.toContain(GAME_ART_STYLE_BLOCK_HEADING);
    expect(composeOpenPixoGamePrompt({ artStyle: null })).toBe(prompt);
    expect(renderGameArtStyleBlock(undefined)).toBe('');
    expect(renderGameArtStyleBlock(null)).toBe('');
  });

  it('keeps the project style facts before media instructions and supplies the style flag', () => {
    const prompt = composeOpenPixoGamePrompt({ engineProfile: PHASER_PROFILE, artStyle: PIXEL_STYLE });
    for (const text of [
      '16-bit pixel (16-bit-pixel)',
      PIXEL_STYLE.prompt,
      PIXEL_STYLE.negativePrompt,
      '#243047, #F8D080',
      'Pixel size: 32',
      'Outline: One-pixel dark outline',
      'Default background: transparent',
      'Recommended resolution: 1024x1024',
      'Keep newly generated assets consistent',
      'code-only recipes ignore them',
      `${PRODUCT_CLI_NAME} media generate --style 16-bit-pixel`,
      'pass the same style to image recipe runs',
    ]) expect(prompt).toContain(text);
    const order = [GAME_ENGINE_BLOCK_HEADING, GAME_ART_STYLE_BLOCK_HEADING, GAME_MEDIA_CONTRACT_HEADING]
      .map((heading) => prompt.indexOf(heading));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('gives a text-only provider style facts without image tool instructions', () => {
    const prompt = composeOpenPixoGamePrompt({ streamFormat: 'plain', artStyle: PIXEL_STYLE });
    expect(prompt).toContain(GAME_ART_STYLE_BLOCK_HEADING);
    expect(prompt).toContain(PIXEL_STYLE.prompt);
    expect(prompt).toContain(PIXEL_STYLE.negativePrompt);
    expect(prompt).toContain('#243047, #F8D080');
    expect(prompt).toContain('no filesystem or tool execution');
    expect(prompt).not.toContain(`${PRODUCT_CLI_NAME} media generate --style`);
    expect(prompt).not.toContain('pass the same style to image recipe runs');
    expect(prompt).not.toContain(GAME_MEDIA_CONTRACT_HEADING);
  });

  it('works in an existing project without a plan conversation', () => {
    const prompt = composeOpenPixoGamePrompt({
       baseDir: 'C:\\Games\\My Game' ,
      locale: 'zh-CN',
      skillName: 'Asset batch', skillBody: 'Read SKILL.md first.',
      pluginBlock: 'Enabled project MCP: game-tools',
      activeStageBlocks: ['Current stage: validate assets'],
      planToolNote: 'Use update_plan.',
      userInstructions: 'Prefer the existing engine.',
      projectInstructions: 'Run the headless game checks.',
    });
    expect(prompt).toContain('# OpenPixo game development workbench');
    expect(prompt).toContain(JSON.stringify('C:\\Games\\My Game'));
    expect(prompt).toContain('write everything the user reads in the user\'s language');
    expect(prompt).toContain('zh-CN');
    for (const text of ['Read SKILL.md first.', 'game-tools', 'validate assets', 'Use update_plan.', 'Prefer the existing engine.', 'Run the headless game checks.']) {
      expect(prompt).toContain(text);
    }
    expect(prompt).not.toContain('Quick brief — 30 seconds');
    expect(prompt).not.toContain('screen-file-first rule');
    expect(prompt).toContain('<question-form>');
    expect(prompt).toContain('approval');
  });

  it('keeps planning and text-only provider limitations explicit', () => {
    const prompt = composeOpenPixoGamePrompt({ baseDir: '/games/test', sessionMode: 'plan', streamFormat: 'plain' });
    expect(prompt).toContain('wait for the user to request execution');
    expect(prompt).toContain('no filesystem or tool execution');
  });

  it('limits the UI fallback to English and Simplified Chinese without restricting conversation language', () => {
    const userInstructions = '日本語で回答してください。';
    for (const [locale, fallback] of [
      ['ja', 'en'], ['pt-BR', 'en'], ['fr', 'en'],
      ['zh-TW', 'zh-CN'], ['zh-Hant', 'zh-CN'], ['zh', 'zh-CN'],
    ]) {
      const prompt = composeOpenPixoGamePrompt({ locale, userInstructions });
      expect(prompt).toContain(`until they write in another language it is ${fallback === 'zh-CN' ? 'Simplified Chinese' : 'English'} (the UI locale is "${fallback}")`);
      expect(prompt).toContain("The user's language is the one they write in");
      expect(prompt).toContain(userInstructions);
      expect(prompt).toContain('Localize form copy to the conversation language');
    }
  });

  it('uses the game composer for managed projects without external metadata', () => {
    expect(composeOpenPixoGamePrompt({})).toContain('# OpenPixo game development workbench');
  });

  it('composes engine, game media and verification blocks in fixed order', () => {
    const prompt = composeOpenPixoGamePrompt({
       baseDir: '/games/phaser', engineProfile: PHASER_PROFILE ,
      projectInstructions: 'Project rule.',
    });
    const order = [
      '# OpenPixo game development workbench',
      GAME_ENGINE_BLOCK_HEADING,
      GAME_MEDIA_CONTRACT_HEADING,
      GAME_VERIFICATION_BLOCK_HEADING,
      '## Project instructions',    ].map((marker) => prompt.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(prompt).toContain('Phaser 3.80.1 (certain');
    expect(prompt).toContain('`public/assets`, `src/assets`');
    expect(prompt).toContain('`npm run build`');
    expect(prompt).toContain('media generate');
    expect(prompt).toContain('media wait <taskId>');
    expect(prompt).toContain('game verify --steps check,build,run --screenshot --json');
    expect(prompt).toContain('game playtest --preset <id> [--seed <n>] --json');
    expect(prompt).toContain('game playtest --list-presets --json');
    expect(prompt).toContain('move [x,y] (hover/aim), mouseDown [x,y], mouseUp [x,y], drag {from:[x,y],to:[x,y],durationMs:300}');
    expect(prompt).toContain('screenshots[].path');
    expect(prompt).not.toContain('Start an image project');
    expect(prompt).not.toContain('新建一个图片项目');
  });

  it('tells the agent to inspect the project when the engine is unknown', () => {
    const prompt = composeOpenPixoGamePrompt({ baseDir: '/games/x', mediaContractBlock: renderGameMediaGenerationContract() });
    expect(prompt).toContain("has not identified this project's engine");
    expect(prompt).toContain('No asset root is known');
    expect(prompt).toContain('media models --json');
  });

  it('states import sidecar rules per engine', () => {
    const unity = composeOpenPixoGamePrompt({ baseDir: '/u', engineProfile: { ...PHASER_PROFILE, engine: 'unity', importMetadata: 'unity-meta', assetRoots: ['Assets'] } });
    expect(unity).toContain('together with its `.meta`');
    const godot = renderGameMediaGenerationContract({ engineProfile: { ...PHASER_PROFILE, engine: 'godot', importMetadata: 'godot-import' } });
    expect(godot).toContain('Godot creates the `.import`');
  });

  it('keeps disabled media semantics on the game path', () => {
    const block = renderGameMediaGenerationContract({ mediaExecution: { mode: 'disabled' } });
    expect(block).toContain('disabled for this run');
    expect(block).toContain('这次运行关闭了媒体生成');
    expect(block).not.toContain('--output <project-relative path');
  });

  it('drops shell-only blocks for a text-only provider', () => {
    const prompt = composeOpenPixoGamePrompt({ baseDir: '/g', streamFormat: 'plain', mediaContractBlock: renderGameMediaGenerationContract() });
    expect(prompt).toContain(GAME_ENGINE_BLOCK_HEADING);
    expect(prompt).not.toContain(GAME_MEDIA_CONTRACT_HEADING);
    expect(prompt).not.toContain(GAME_VERIFICATION_BLOCK_HEADING);
  });

  it('lists recipes between game media and verification, truncated with a pointer to the catalogue', () => {
    const recipes = Array.from({ length: 14 }, (_, i) => ({ id: `openpixo/r${i}`, title: `Recipe ${i}`, surface: 'image', category: 'character', verified: i === 0 }));
    const block = renderGameRecipesBlock(recipes);
    expect(block).toContain('- `openpixo/r0` (image/character): Recipe 0');
    expect(block.split('\n').find(line => line.startsWith('- `openpixo/r0`'))).not.toContain('unverified');
    expect(block).toContain('Recipe 1 (unverified: not yet accepted against a real provider; inspect output before adopting)');
    expect(block).not.toContain('Recipes are tested pipelines');
    expect(block).toContain('openpixo/r11');
    expect(block).not.toContain('openpixo/r12');
    expect(block).toContain(`+2 more, see \`${PRODUCT_CLI_NAME} recipe list --json\``);
    expect(block).toContain('recipe adopt <runId> --candidate <candidateId>');
    expect(block).toContain('Never adopt blindly');
    expect(renderGameRecipesBlock([])).toBe('');
    expect(renderGameRecipesBlock(undefined)).toBe('');

    const prompt = composeOpenPixoGamePrompt({
       baseDir: '/games/phaser', engineProfile: PHASER_PROFILE ,
      recipes: recipes.slice(0, 2),
    });
    const order = [GAME_MEDIA_CONTRACT_HEADING, GAME_RECIPES_BLOCK_HEADING, GAME_VERIFICATION_BLOCK_HEADING].map((marker) => prompt.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(prompt).not.toContain('more, see');
    expect(composeOpenPixoGamePrompt({ baseDir: '/g' })).not.toContain(GAME_RECIPES_BLOCK_HEADING);
    expect(composeOpenPixoGamePrompt({ baseDir: '/g', streamFormat: 'plain', recipes })).not.toContain(GAME_RECIPES_BLOCK_HEADING);
  });
});

describe('media contract: what can really make art', () => {
  const emptyCatalog = { image: [], video: [], audioMusic: [], audioSpeech: [], audioSfx: [] };

  it('tells the user how to go on when spending credits needs their confirmation', () => {
    const block = renderGameMediaGenerationContract();
    const rule = block.split('\n').find(line => line.startsWith('- `confirm-in-app`'));
    expect(rule).toContain('only you can approve');
    expect(rule).toContain('只有你本人能确认');
    expect(rule).not.toMatch(/contact us|联系我们/);
    expect(rule).toContain('Set an art budget');
    expect(rule).toContain('美术预算');
  });

  it('tells the agent to stop, not retry, when the budget is used up, in both languages', () => {
    const block = renderGameMediaGenerationContract();
    const rule = block.split('\n').find(line => line.startsWith('- `raise-art-budget`'));
    expect(rule).toContain('do not dispatch again');
    expect(rule).toContain('You can raise the budget once this turn ends');
    expect(rule).toContain('这一轮结束后可以调高预算');
    expect(block).toContain('anything else: do not re-dispatch');
  });

  it('sends the budget figures as a per-turn note, not in the media contract', () => {
    const left = renderArtBudgetTurnNote({ limitCredits: 100, usedCredits: 12, remainingCredits: 88 });
    expect(left).toContain('12 of 100 credits used, 88 left');
    expect(left).not.toContain('raise-art-budget');
    const gone = renderArtBudgetTurnNote({ limitCredits: 100, usedCredits: 100, remainingCredits: 0 });
    expect(gone).toContain('100 of 100 credits used, 0 left');
    expect(gone).toContain('do not dispatch a model that spends credits');
    expect(gone).toContain('raise-art-budget');
    expect(renderGameMediaGenerationContract()).not.toContain('Art budget this turn');
  });

  it('says so plainly when no image model can run, so the agent does not try and fail', () => {
    const block = renderGameMediaGenerationContract({ modelCatalog: emptyCatalog });
    expect(block).toContain('- image: (none)');
    expect(block).toContain('No image model can run right now');
    expect(block).toContain('Do not call `media generate --surface image`');
    expect(block).toContain('No image generator is connected yet');
    expect(block).toContain('还没有连接图片生成器');
    expect(block).not.toContain('fal-ai/');
  });

  /*
   * 2026-11-10 beginner audit: a signed-in user with only credits was told to connect
   * Codex or an image API key, because the no-image rule knew nothing of credits.
   */
  it('points a signed-in user with no art budget yet at the budget, not at Codex', () => {
    const block = renderGameMediaGenerationContract({ modelCatalog: { ...emptyCatalog, artBudgetUnset: true } });
    const rule = block.slice(block.indexOf('**No image model can run right now**')).split('\n')[0];
    expect(block).toContain('- image: (none)');
    expect(rule).toContain('Do not call `media generate --surface image`');
    expect(rule).toContain('set an art budget');
    expect(rule).toContain('美术预算');
    expect(rule).not.toContain('Codex');
    expect(rule).not.toMatch(/\bfal\b/);
    expect(block).not.toContain('No image generator is connected yet');
    expect(block).not.toContain('还没有连接图片生成器');
  });

  it('says nothing of the kind when a model can run', () => {
    const block = renderGameMediaGenerationContract({
      modelCatalog: { ...emptyCatalog, image: ['codex-image'], defaultImageModel: 'codex-image' },
    });
    expect(block).toContain('- image: `codex-image`');
    expect(block).toContain('otherwise `codex-image`');
    expect(block).not.toContain('No image model can run right now');
  });

  it('names the Settings image pick as the default, or says why it could not be used', () => {
    const picked = renderGameMediaGenerationContract({
      modelCatalog: { ...emptyCatalog, image: ['codex-image', 'gpt-image-2'], defaultImageModel: 'gpt-image-2', defaultImageModelIsUserChoice: true },
    });
    expect(picked).toContain('otherwise `gpt-image-2`, the image model the user picked in Settings');
    for (const [reason, zh] of [['not-connected', '现在没连上'], ['needs-art-budget', '美术预算'], ['unknown-model', '这个版本里用不了']] as const) {
      const block = renderGameMediaGenerationContract({
        modelCatalog: { ...emptyCatalog, image: ['codex-image'], defaultImageModel: 'codex-image', unavailableImageChoice: { id: 'gpt-image-2', reason } },
      });
      expect(block).toContain('The user picked `gpt-image-2` in Settings as the image model, but it cannot run in this run');
      expect(block).toContain(zh);
      expect(block).toContain('otherwise `codex-image`.');
    }
  });

  it('advertises no passthrough ids, and keeps the no-registry path', () => {
    expect(renderGameMediaGenerationContract({ modelCatalog: { ...emptyCatalog, image: ['x'] } })).not.toContain('fal-ai/');
    expect(renderGameMediaGenerationContract()).toContain('media models --json');
  });
});

describe('game art decisions in the media contract', () => {
  it('lets the agent decide to generate art and pick a bounded size', () => {
    const block = renderGameMediaGenerationContract({ engineProfile: PHASER_PROFILE });
    expect(block).toContain(GAME_ART_DECISION_HEADING);
    expect(block).toContain('The user does not have to ask for "an image"');
    // A new game built from an approved plan confirms the list first (owner decision 2026-11-10).
    expect(block).toContain('In\na new game built from an approved plan, list what you will make first and wait\nfor the user\'s OK');
    expect(block).toContain('in any other project, make them on\nyour own');
    expect(block).toContain(`capped at\n${IMAGE_OUTPUT_MAX_EDGE} px`);
    expect(block).toContain('[--size <W>x<H> | --width <px> [--height <px>]] [--transparent | --background scene]');
    expect(block).toContain('| UI icon, item, pickup | 64-128, square | `--transparent` |');
    expect(block).toContain('do not describe a checkerboard');
    expect(block).not.toContain('Put exact needs in the prompt: pixel size');
    // The prompt carries the decision rules only on tool-capable runs.
    expect(composeOpenPixoGamePrompt({ baseDir: '/g' })).toContain(GAME_ART_DECISION_HEADING);
    expect(composeOpenPixoGamePrompt({ baseDir: '/g', streamFormat: 'plain' })).not.toContain(GAME_ART_DECISION_HEADING);
    expect(renderGameMediaGenerationContract({ mediaExecution: { mode: 'disabled' } })).not.toContain(GAME_ART_DECISION_HEADING);
  });
});
