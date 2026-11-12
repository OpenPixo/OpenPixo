import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { listSkills } from '../src/skills.js';
import { localizeExamples } from '../src/styles/service.js';

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
it('reads sidecar examples without losing English fallbacks or their locale maps', async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'openpixo-skill-examples-'));
  const folder = path.join(root, 'sprite-helper');
  await mkdir(folder);
  await writeFile(path.join(folder, 'SKILL.md'), '---\nname: sprite-helper\ndescription: Make sprites.\n---\nMake sprites.');
  const examples = [{ title: 'Knight sprite', title_i18n: { 'zh-CN': 'Localized title' }, prompt: 'Make a knight sprite.', prompt_i18n: { 'zh-CN': 'Localized prompt' } }];
  await writeFile(path.join(folder, 'pixo.json'), JSON.stringify({ examples }));
  const entries = await listSkills(root);
  expect(entries[0]?.examples).toEqual(examples);
  expect(localizeExamples(entries[0]?.examples, 'zh-CN')).toMatchObject([{ title: 'Localized title', prompt: 'Localized prompt' }]);
  expect(localizeExamples(entries[0]?.examples, 'en')).toMatchObject([{ title: 'Knight sprite', prompt: 'Make a knight sprite.' }]);
  await writeFile(path.join(folder, 'pixo.json'), JSON.stringify({ examples: [{ title: 'Invalid', prompt: 'Invalid', extra: true }] }));
  expect((await listSkills(root))[0]?.examples).toBeUndefined();
});
