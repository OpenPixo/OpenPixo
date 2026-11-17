import { expect, it } from 'vitest';
import { renderGameMediaGenerationContract } from '../src/prompts/media-contract.js';

it('starts a make-or-remake request with the generation and reads the game only to connect the result', () => {
  // "虎杖人物走路动画 重新生成" spent 44 credits over two turns reading folder trees, old pipelines and the last
  // attempt's frames before generating anything (2026-11-16).
  const contract = renderGameMediaGenerationContract();
  expect(contract).toContain('When the user asks you to make or remake an asset (a walk, a sprite, a\nbackground, a sound), the generation is the work.');
  expect(contract).toContain('Start the recipe or generation, then read the rest of the game only to\nconnect the result.');
  expect(contract).toContain('earlier attempts, old\npipeline notes and scripts, logs and derived files are not inputs to a remake.');
});
