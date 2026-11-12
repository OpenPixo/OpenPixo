import { describe, expect, it } from 'vitest';
import { ART_BUDGET_ESTIMATE_CREDITS } from '../src/api/art-budget.js';
import {
  GAME_PLAN_APPROVE_LABELS,
  GAME_PLAN_CONCEPT_IMAGE_LIMIT,
  gamePlanIsPending,
  type GameEngineOption,
} from '../src/api/game-plan.js';
import type { EngineProfile } from '../src/api/game-project.js';
import {
  composeOpenPixoGamePrompt,
  GAME_ENGINE_BLOCK_HEADING,
  GAME_EXPERIENCE_BLOCK_HEADING,
  GAME_PLAN_STEPS,
  renderGameExperienceBlock,
  renderGamePlanTurnNote,
  renderLanguageRule,
  GAME_PLAN_BLOCK_HEADING,
  GAME_RECIPES_BLOCK_HEADING,
  GAME_SETUP_BLOCK_HEADING,
  GAME_SCREEN_AND_TEXT_HEADING,
  GAME_SHAPE_BLOCK_HEADING,
  GAME_VERIFICATION_BLOCK_HEADING,
  QUESTION_FORM_CONTRACT,
} from '../src/prompts/openpixo-game.js';

const engineOptions: GameEngineOption[] = [
  { engine: 'phaser', name: 'Phaser', templates: [{ id: 'phaser3-vite', name: 'Phaser 3 · 2D' }], available: true, missingTools: [] },
  { engine: 'godot', name: 'Godot', templates: [{ id: 'godot4-2d', name: 'Godot 4 · 2D' }], available: false, missingTools: ['godot'] },
];
const artStyles = [{ id: 'pixel-16-bit', title: '16-bit pixel' }];
const planning = { status: 'planning' as const, engineOptions, artStyles };
const phaser: EngineProfile = {
  detectorVersion: 1, engine: 'phaser', confidence: 'certain', evidence: ['package.json'], languages: ['TypeScript'],
  assetRoots: ['public'], importMetadata: 'none', commands: {}, tools: [], detectedAt: 0,
};

function blockOf(prompt: string, heading: string): string {
  const start = prompt.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = prompt.indexOf('\n## ', start + heading.length);
  return next < 0 ? prompt.slice(start) : prompt.slice(start, next);
}

describe('a new game is planned before it is built', () => {
  const prompt = composeOpenPixoGamePrompt({ gamePlan: planning });
  const block = blockOf(prompt, GAME_PLAN_BLOCK_HEADING);

  it('walks gameplay, art, engine and tech, the plan and the build in that order', () => {
    const order = ['Gameplay', 'Art', 'Engine and tech', 'Plan', 'Build'].map(step => block.indexOf(`**${step}**`));
    expect(order.every(index => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('labels every planning reply with its step, in the user\'s language', () => {
    expect(block).toContain('Start every planning reply with the step label in the user\'s language');
    expect(block).toContain('"第 2 步 / 共 5 步：画风" / "Step 2 of 5: Art"');
  });

  it('asks through question forms with concrete choices and recommendations, a few at a time', () => {
    expect(block).toContain('<question-form>');
    expect(block).toMatch(/at most 3 questions/i);
    expect(block).toMatch(/concrete options a beginner can pick from/);
    expect(block).toMatch(/recommended one listed first/);
  });

  it('has the user confirm every step before the next, and never skips one because setup answered it', () => {
    expect(block).toMatch(/A step may take several turns/);
    expect(block).toMatch(/end the turn and wait/);
    expect(block).toMatch(/End every step by asking the user to confirm it, and go on to the next step only once they have/);
    expect(block).toMatch(/Two steps never share a form/);
    expect(block).toMatch(/Never skip a step because Game setup answers it/);
    expect(block).toMatch(/starting points to confirm, not settled facts/);
    expect(block).toMatch(/\*\*Plan\*\* \(计划\): only once steps 1 to 3 are confirmed/);
    // The old rules this replaces (owner decision 2026-11-10).
    expect(block).not.toMatch(/Skip whatever/);
  });

  it('settles gameplay with concrete examples and a one-minute description the user confirms', () => {
    expect(block).toMatch(/what the player does second to second, the goal, how they win and lose, the controls, what makes it fun or different, and how big the first version is/);
    expect(block).toContain('玩一分钟是这样的');
    expect(block).toMatch(/Ask the user to confirm it or correct it/);
  });

  /*
   * 2026-11-10 beginner audit: a first-timer picked 「一整座小基地、5 种作物、4 种设施、完整四季」
   * over the small version; the agent said 「做的过程仍会分几步」 and moved on.
   */
  it('says once what a bigger first version costs and recommends starting small, then respects the choice', () => {
    const gameplay = block.slice(block.indexOf('1. **Gameplay**'), block.indexOf('2. **'));
    expect(gameplay).toMatch(/bigger first version than the one you recommended/);
    expect(gameplay).toMatch(/more stages, more time and more credits/);
    expect(gameplay).toMatch(/recommend starting with the small version/);
    expect(gameplay).toMatch(/Say it once/);
  });

  /*
   * 2026-11-10 beginner audit: the plan turn put all six stages in `todowrite`, so the plan
   * message and every build turn after it said 「任务尚未完成 · 本次任务仍有 N 项内容未完成」
   * and offered 「继续剩余任务」, pushing against one stage per turn.
   */
  it('keeps the stages out of the to-do list, while planning and while building', () => {
    expect(block).toMatch(/Do not put the steps or the build stages in your to-do or plan tool/);
    const building = blockOf(composeOpenPixoGamePrompt({ gamePlan: { status: 'approved' } }), GAME_PLAN_BLOCK_HEADING);
    expect(building).toMatch(/to-do or plan tool holds only this stage's own steps, never the later stages/);
  });

  it('shows two or three style samples of the confirmed game and keeps the picked one as the reference', () => {
    expect(block).toContain('`pixel-16-bit`');
    expect(block).toContain('16-bit pixel');
    expect(block).toMatch(/Make 2 or 3 small style samples of this game/);
    expect(block).toMatch(/mock gameplay screen of the confirmed game/);
    expect(block).toContain('media generate --surface image');
    expect(block).toContain('--output concept/style-<n>.png');
    expect(block).toContain('--style <id>');
    expect(block).toContain(String(GAME_PLAN_CONCEPT_IMAGE_LIMIT));
    expect(block).toMatch(/The picked image is the game's style reference/);
    expect(block).toMatch(/never impose a style's own palette/);
    // The style's own palette is only a suggestion; a palette the user set is the requirement.
    const styled = composeOpenPixoGamePrompt({ gamePlan: planning, artStyle: { id: 's', title: 'S', prompt: 'p', negativePrompt: 'n', palette: ['#112233'] } });
    expect(styled).toContain('Style palette, a suggestion that comes with the style and never a requirement (only a palette the user set is one): #112233.');
    expect(styled).not.toContain('Palette: #112233');
  });

  it('pays for samples without letting the agent set a budget', () => {
    expect(block).toMatch(/costs the user nothing extra/);
    expect(block).toContain(`about ${ART_BUDGET_ESTIMATE_CREDITS.image} credits a sample`);
    expect(block).toContain(`for about ${3 * ART_BUDGET_ESTIMATE_CREDITS.image} credits`);
    expect(block).toMatch(/enter an art budget on the bar above the message box, press "Save" \(保存\) and then answer; you cannot set it/);
    expect(block).toMatch(/describe 2 or 3 candidate styles in words, each with one or two well-known games/);
    expect(block).toMatch(/replaces the media section's sentence about no image model/);
  });

  it('offers engines with what this machine really has, and asks for a recommendation', () => {
    expect(block).toContain('`phaser3-vite`');
    expect(block).toMatch(/Godot.*not found on this machine/);
    expect(block).toMatch(/Recommend one that is ready on this machine/);
    expect(block).toMatch(/picks one that is not on this machine, say plainly that it has to be installed/);
  });

  it('raises an engine the starter chose but this computer lacks, offering the ready ones', () => {
    const godot: EngineProfile = { ...phaser, engine: 'godot', importMetadata: 'godot-import', tools: [{ id: 'godot', resolved: false }] };
    const prompt = composeOpenPixoGamePrompt({ gamePlan: planning, engineProfile: godot });
    const engineStep = blockOf(prompt, GAME_PLAN_BLOCK_HEADING);
    expect(engineStep).toMatch(/already chosen: Godot, so do not ask which engine again/);
    expect(engineStep).toMatch(/`godot` is not found on this computer/);
    expect(engineStep).toMatch(/install it .* or switch to an engine that runs here \(Phaser\)/);
    expect(engineStep).toMatch(/the written plan starts with installing it/);
    // The engine block says the same for every later turn.
    expect(blockOf(prompt, GAME_ENGINE_BLOCK_HEADING)).toMatch(/wait for their answer/);
    // A ready engine is neither questioned nor flagged.
    const ready = blockOf(composeOpenPixoGamePrompt({ gamePlan: planning, engineProfile: { ...godot, tools: [{ id: 'godot', resolved: true }] } }), GAME_PLAN_BLOCK_HEADING);
    expect(ready).toMatch(/already chosen: Godot, and it is ready here\. Do not ask which engine again/);
    expect(ready).not.toMatch(/not found on this computer/);
  });

  it('names the approve button and says the agent cannot approve', () => {
    expect(block).toContain(GAME_PLAN_APPROVE_LABELS.en);
    expect(block).toContain(GAME_PLAN_APPROVE_LABELS['zh-CN']);
    expect(block).toMatch(/only the user's approval/i);
    expect(block).toMatch(/cannot approve/i);
  });

  it('has the written plan estimate the art, and says the budget is the user\'s', () => {
    expect(block).toMatch(/List the art to be made/);
    expect(block).toMatch(/how many images that is and what it costs/);
    expect(block).toContain(`about ${ART_BUDGET_ESTIMATE_CREDITS.image} credits a new image`);
    expect(block).toMatch(/The user sets that budget on the approve bar; you cannot set it/);
  });

  it('limits autonomous art to after approval', () => {
    expect(block).toMatch(/The media rule about making art applies only after approval; before it, make only the style samples/);
  });

  it('writes a short plan of build stages, each with what the user can try and the art it needs', () => {
    expect(block).toMatch(/3 to 6 build stages \(阶段\)/);
    expect(block).toMatch(/stage 1 is the smallest playable version of the core loop/);
    expect(block).toMatch(/what the user will be able to try at its end and which art it needs/);
    expect(block).toMatch(/in the user's language and plain words/);
  });

  it('follows these steps even when the app\'s kickoff message names a shorter route', () => {
    expect(block).toMatch(/When it calls the setup answers decided, confirm them briefly instead of asking them again/);
    expect(block).toMatch(/when it names a shorter route .*still follow these steps/);
  });

  it('says the run is read-only and drops the build-time blocks', () => {
    expect(prompt).toMatch(/read-only/);
    expect(prompt).not.toContain('wait for the user to request execution');
    expect(prompt).not.toContain(GAME_VERIFICATION_BLOCK_HEADING);
    expect(composeOpenPixoGamePrompt({ gamePlan: planning, recipes: [{ id: 'openpixo/r', title: 'R', surface: 'image', verified: true }] }))
      .not.toContain(GAME_RECIPES_BLOCK_HEADING);
  });

  it('no longer forbids a discovery conversation anywhere', () => {
    expect(prompt).not.toMatch(/Do not start a design brief/);
    expect(prompt).not.toMatch(/discovery interview/);
    expect(QUESTION_FORM_CONTRACT).toMatch(/planning a new game/);
  });

  it('does not ask for the engine when the template already decided it', () => {
    const decided = composeOpenPixoGamePrompt({ gamePlan: planning, engineProfile: phaser });
    const engineStep = blockOf(decided, GAME_PLAN_BLOCK_HEADING);
    expect(engineStep).toMatch(/already chosen/);
    expect(engineStep).not.toContain('`godot4-2d`');
    expect(decided).toContain(GAME_ENGINE_BLOCK_HEADING);
  });

  it('does not ask a new project to inspect for an engine it has not chosen', () => {
    expect(prompt).not.toContain(GAME_ENGINE_BLOCK_HEADING);
  });

  it('keeps the setup answers as facts ahead of the plan', () => {
    const withSetup = composeOpenPixoGamePrompt({ gamePlan: planning, gameSetup: { genre: 'platformer' } });
    expect(withSetup.indexOf(GAME_SETUP_BLOCK_HEADING)).toBeLessThan(withSetup.indexOf(GAME_PLAN_BLOCK_HEADING));
  });

  it('keeps a text-only provider on the conversation, with no tool commands', () => {
    const plain = blockOf(composeOpenPixoGamePrompt({ gamePlan: planning, streamFormat: 'plain' }), GAME_PLAN_BLOCK_HEADING);
    expect(plain).toContain('**Gameplay');
    expect(plain).not.toContain('media generate');
    expect(plain).not.toContain('pixo');
  });

  it('does not ask where the game is sold, and leaves Steam out of planning', () => {
    expect(block).toMatch(/Do not ask where the game will be sold/);
    expect(block).not.toContain('Steam');
  });
});

describe('a quick game keeps every step, each one short', () => {
  const quick = (extra: Parameters<typeof composeOpenPixoGamePrompt>[0] = {}) => blockOf(
    composeOpenPixoGamePrompt({ gamePlan: planning, gameSetup: { genre: 'puzzle', scope: 'quick' }, ...extra }), GAME_PLAN_BLOCK_HEADING);

  it('walks the same steps, short, with two samples and three stages, still confirming each', () => {
    const block = quick();
    for (const step of ['Gameplay', 'Art', 'Engine and tech', 'Plan']) expect(block).toContain(`**${step}**`);
    expect(block).toMatch(/Keep every step short/);
    expect(block).toMatch(/still confirm each step with the user/);
    expect(block).toMatch(/shareable as a link/);
    expect(block).toMatch(/Make 2 small style samples/);
    expect(block).toMatch(/Then 3 build stages/);
    expect(block).toContain(GAME_PLAN_APPROVE_LABELS.en);
    expect(block).toMatch(/cannot approve for them/);
    // The one-round shortcut is gone (owner decision 2026-11-10).
    expect(block).not.toMatch(/one short round/);
    expect(block).not.toMatch(/3 to 5 lines/);
  });

  it('preselects Phaser and still allows Godot, with its install note', () => {
    const block = quick();
    expect(block).toMatch(/preselect Phaser/);
    expect(block).toMatch(/Godot is fine when the user asks for it.*installing first.*desktop games/);
    expect(block).toContain('`phaser3-vite`');
    expect(block).toMatch(/Godot.*not found on this machine/);
  });

  it('confirms an engine the starter already chose in one sentence', () => {
    expect(quick({ engineProfile: phaser })).toMatch(/already chosen: Phaser, and it is ready here\. Do not ask which engine again: confirm it in one sentence/);
  });

  it('keeps crafted and long games on the full walk', () => {
    for (const scope of ['crafted', 'long'] as const) {
      const block = blockOf(composeOpenPixoGamePrompt({ gamePlan: planning, gameSetup: { genre: 'puzzle', scope } }), GAME_PLAN_BLOCK_HEADING);
      expect(block).toMatch(/3 to 6 build stages/);
      expect(block).not.toMatch(/Keep every step short/);
    }
  });
});

describe('after approval, and for games that already exist', () => {
  it('builds the approved plan one stage per turn, starting from a starter', () => {
    const prompt = composeOpenPixoGamePrompt({ gamePlan: { status: 'approved', engineOptions } });
    const block = blockOf(prompt, GAME_PLAN_BLOCK_HEADING);
    expect(block).toMatch(/approved/);
    expect(block).toMatch(/Do not run the planning conversation again/);
    expect(block).toContain('game scaffold --template');
    expect(block).toContain('`phaser3-vite`');
    expect(block).toMatch(/approved engine is not on this machine, do not scaffold or build around it/);
    expect(prompt).toContain(GAME_VERIFICATION_BLOCK_HEADING);
    expect(prompt).not.toMatch(/\*\*Gameplay/);
    // The rule this replaces (owner decision 2026-11-10).
    expect(block).not.toMatch(/Build what it says/);
  });

  it('labels each stage, builds only it, says how to try it and waits for the user', () => {
    const block = blockOf(composeOpenPixoGamePrompt({ gamePlan: { status: 'approved' }, engineProfile: phaser }), GAME_PLAN_BLOCK_HEADING);
    expect(block).toContain('"阶段 1 / 共 4：能玩的最小版本" / "Stage 1 of 4: the smallest playable version"');
    expect(block).toMatch(/Take the current stage from your last stage label in this conversation; the first build turn is stage 1/);
    expect(block).toMatch(/Build only the current stage\. Then run it and playtest its loop with real input until it is playable as Verification defines it \(move, win, lose\), and say what you tried and what happened/);
    expect(block).toMatch(/exactly how to try it/);
    expect(block).toMatch(/End the turn with a <question-form>: go on to the next stage \(name it\), or what to change first/);
    expect(block).toMatch(/Never start the next stage until the user says so/);
  });

  it('lists the art it will make and waits for the user before generating it', () => {
    const block = blockOf(composeOpenPixoGamePrompt({ gamePlan: { status: 'approved' } }), GAME_PLAN_BLOCK_HEADING);
    expect(block).toMatch(/Before generating any art, list what you will make \(what, how many, the animation states of each character that moves, and about how many credits when it is paid from the art budget\) and wait for the user's OK/);
  });

  it('states the plan the host recorded at approval, or where to find it', () => {
    const recorded = blockOf(composeOpenPixoGamePrompt({ gamePlan: { status: 'approved', approvedPlan: '阶段 1：跳跃\n阶段 2：敌人' } }), GAME_PLAN_BLOCK_HEADING);
    expect(recorded).toContain('<approved-plan>\n阶段 1：跳跃\n阶段 2：敌人\n</approved-plan>');
    expect(recorded).toMatch(/changes the user asked for in chat since then win over it/);
    const older = blockOf(composeOpenPixoGamePrompt({ gamePlan: { status: 'approved' } }), GAME_PLAN_BLOCK_HEADING);
    expect(older).not.toContain('<approved-plan>');
    expect(older).toMatch(/it is your last message before their approval/);
  });

  it('stops pointing at a starter once the project has an engine', () => {
    const block = blockOf(composeOpenPixoGamePrompt({ gamePlan: { status: 'approved', engineOptions }, engineProfile: phaser }), GAME_PLAN_BLOCK_HEADING);
    expect(block).not.toContain('game scaffold');
  });

  it('leaves an imported game on ordinary work, with no plan block', () => {
    const prompt = composeOpenPixoGamePrompt({ engineProfile: phaser });
    expect(prompt).not.toContain(GAME_PLAN_BLOCK_HEADING);
    expect(prompt).toMatch(/reasonable assumptions/);
  });

  it('reads pending state from project metadata only', () => {
    expect(gamePlanIsPending({ gamePlan: { status: 'planning', startedAt: 1 } })).toBe(true);
    expect(gamePlanIsPending({ gamePlan: { status: 'approved', startedAt: 1, approvedAt: 2 } })).toBe(false);
    expect(gamePlanIsPending({})).toBe(false);
    expect(gamePlanIsPending(null)).toBe(false);
  });
});

describe('a game is a game, not a webpage', () => {
  const block = blockOf(composeOpenPixoGamePrompt({}), GAME_SHAPE_BLOCK_HEADING);

  it('makes a web game the whole window, drawn as in-game scenes', () => {
    expect(block).toMatch(/whole window/);
    expect(block).toMatch(/full-viewport canvas/);
    for (const scene of ['title screen', 'level select', 'HUD', 'pause', 'credits']) expect(block).toContain(scene);
  });

  it('rules out the landing-page shape by name', () => {
    for (const part of ['landing page', 'hero section', 'marketing copy', 'page header', 'footer']) expect(block).toContain(part);
    expect(block).toMatch(/game (embedded )?in a box/);
  });

  it('keeps web-design skills away from the game, including global ones', () => {
    expect(block).toMatch(/web-design skills?/);
    expect(block).toMatch(/global/);
  });

  it('leaves desktop engines to their own conventions and honours an explicit request for a site', () => {
    expect(block).toMatch(/Desktop engines/);
    expect(block).toMatch(/explicitly asks for a website/);
  });

  // Owner report 2026-11-11: pixel games shipped small blown-up canvases with unreadable text.
  it('keeps the canvas large, zooms the world for pixel art and sets a floor for text', () => {
    expect(block).toContain(GAME_SCREEN_AND_TEXT_HEADING);
    expect(block).toContain('Never draw a small canvas and let the browser blow it up');
    expect(block).toContain('Do not set Phaser `pixelArt: true` or `antialias: false` on the whole game');
    expect(block).toContain('stretch mode `canvas_items`');
    expect(block).toMatch(/text is at least 16 px tall/);
    expect(block).toMatch(/every string must be readable/);
    const setup = composeOpenPixoGamePrompt({ gameSetup: { display: { width: 320, height: 180, scaling: 'pixel-perfect' } } });
    expect(setup).toContain('- Pixel resolution: 320x180 world pixels on screen (landscape; not the canvas size)');
    expect(setup).not.toContain('Base resolution: 320x180');
  });

  it('applies on every path, including text-only providers', () => {
    for (const input of [{ gamePlan: planning }, { gamePlan: { status: 'approved' as const } }, { streamFormat: 'plain' }]) {
      expect(composeOpenPixoGamePrompt(input)).toContain(GAME_SHAPE_BLOCK_HEADING);
    }
  });
});


describe('the user reads their own language, at their own level', () => {
  it('writes everything the user reads in Simplified Chinese on a zh-CN app until they write otherwise', () => {
    const rule = renderLanguageRule('zh-CN');
    expect(rule).toMatch(/replies, <question-form> titles, questions and options, step and stage labels, plans, stage summaries and follow-ups/);
    expect(rule).toContain('until they write in another language it is Simplified Chinese (the UI locale is "zh-CN")');
    expect(rule).toMatch(/Game setup values and tool output are English for the host's sake/);
    expect(rule).toMatch(/translate a setup value when you mention it/);
    expect(rule).toMatch(/Keep code, filenames, commands, tool names and technical identifiers exact/);
    expect(composeOpenPixoGamePrompt({ locale: 'zh-CN', gamePlan: planning })).toContain(rule);
  });

  it('tells a first-timer\'s agent to explain terms, offer examples and leave out engine jargon', () => {
    const prompt = composeOpenPixoGamePrompt({ gamePlan: planning, gameSetup: { genre: 'platformer' }, gameExperience: 'first' });
    const block = blockOf(prompt, GAME_EXPERIENCE_BLOCK_HEADING);
    expect(block).toMatch(/first time/);
    expect(block).toMatch(/explain it in a few words/);
    expect(block).toMatch(/concrete choices with a short example each/);
    expect(block).toMatch(/Do not bring up engines, frameworks, file formats or code unless/);
    expect(prompt.indexOf(GAME_SETUP_BLOCK_HEADING)).toBeLessThan(prompt.indexOf(GAME_EXPERIENCE_BLOCK_HEADING));
    expect(prompt.indexOf(GAME_EXPERIENCE_BLOCK_HEADING)).toBeLessThan(prompt.indexOf(GAME_PLAN_BLOCK_HEADING));
    expect(blockOf(prompt, GAME_PLAN_BLOCK_HEADING)).toMatch(/a sentence a beginner understands/);
  });

  it('says nothing about experience the user has not given', () => {
    expect(renderGameExperienceBlock(undefined)).toBe('');
    expect(renderGameExperienceBlock(null)).toBe('');
    expect(composeOpenPixoGamePrompt({ gamePlan: planning })).not.toContain(GAME_EXPERIENCE_BLOCK_HEADING);
    expect(renderGameExperienceBlock('experienced')).toMatch(/standard terms without explaining them/);
  });

  it('treats setup answers as starting points while planning and as requirements afterwards', () => {
    const setup = { genre: 'platformer' };
    expect(blockOf(composeOpenPixoGamePrompt({ gamePlan: planning, gameSetup: setup }), GAME_SETUP_BLOCK_HEADING)).toMatch(/starting points to confirm with the user, not settled facts/);
    expect(blockOf(composeOpenPixoGamePrompt({ gamePlan: { status: 'approved' }, gameSetup: setup }), GAME_SETUP_BLOCK_HEADING)).toMatch(/Treat them as requirements/);
  });

  it('repeats the step or stage label and the language every turn, outside the stable prompt', () => {
    const planningNote = renderGamePlanTurnNote('planning', 'zh-CN');
    expect(planningNote).toMatch(/label of the step you are on/);
    expect(planningNote).toContain('in Simplified Chinese unless the user writes in another language');
    const buildingNote = renderGamePlanTurnNote('approved', 'en');
    expect(buildingNote).toMatch(/label of the stage you are on/);
    expect(buildingNote).toMatch(/build only that stage/);
    expect(buildingNote).toContain('in the user\'s language');
    expect(renderGamePlanTurnNote(undefined, 'zh-CN')).toBe('');
    // Not part of the composed (cached) prompt.
    expect(composeOpenPixoGamePrompt({ locale: 'zh-CN', gamePlan: planning })).not.toContain(planningNote);
  });

  it('labels each planning step in both UI languages', () => {
    expect(GAME_PLAN_STEPS.map(step => step['zh-CN'])).toEqual(['玩法', '画风', '引擎与技术', '计划', '制作']);
  });
});
