import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { PluginManifestSchema, type InputField } from '../packages/contracts/src/plugins/manifest.ts';

interface PromptTemplate { id: string; title: string; prompt: string; summary?: string; category?: string; tags?: string[]; model?: string; aspect?: string; source?: { license?: string; [key: string]: unknown } }
// Deliberately conservative: imported candidates still require curation before publication.
const COMMERCIAL_IP = /pokemon|pokémon|mario|zelda|nintendo|minecraft|genshin|honkai|fortnite|valorant|overwatch|diablo|elden ring|dark souls|final fantasy|league of legends|warcraft|warhammer|stardew valley|hollow knight|cuphead|sonic|animal crossing|dota|counter.strike|cs:go|apex legends|cyberpunk\s*2077|grand theft auto|\bgta\b|hades|clash of clans|brawl stars|the sims|fallout|resident evil|silent hill|tomb raider|metal gear|assassin.s creed|god of war|dragon quest|roblox|marvel|disney|pixar|dreamworks|star wars|harry potter|lord of the rings|one piece|naruto|dragon ball|demon slayer|jujutsu|evangelion|gundam|原神|宝可梦|塞尔达|马里奥|黑神话|王者荣耀|崩坏/i;
const GAME_ASSET = /game|sprite|tileset|pixel.art|texture|skybox|character|icon|nine.slice|游戏|精灵|角色|贴图|像素/i;

export function convertPromptTemplate(template: PromptTemplate): unknown | null {
  const text = JSON.stringify(template);
  if (!GAME_ASSET.test(text) || COMMERCIAL_IP.test(text)) return null;
  const inputs = new Map<string, InputField>();
  const prompt = template.prompt.replace(/\{argument\s+([^{}]*?)\}/g, (_match, attributes: string) => {
    const normalized = attributes.replace(/\\+"/g, '"');
    const label = normalized.match(/\bname="([^"]+)"/)?.[1];
    if (!label) throw new Error(`Invalid argument in ${template.id}`);
    const name = label.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^([^a-zA-Z_])/, 'input_$1');
    if (!name) throw new Error(`Empty argument in ${template.id}`);
    const existing = inputs.get(name);
    if (existing && existing.label !== label) throw new Error(`Colliding arguments in ${template.id}`);
    const defaultValue = normalized.match(/\bdefault="([^"]*)"/)?.[1];
    inputs.set(name, { name, label, type: 'text', ...(defaultValue === undefined ? { required: true } : { default: defaultValue }) });
    return `{{${name}}}`;
  });
  return PluginManifestSchema.parse({ name: template.id, title: template.title, description: template.summary ?? '', version: '0.1.0',
    ...(template.source ? { source: template.source, license: template.source.license } : {}),
    pixo: { kind: 'recipe', recipe: { surface: 'image', category: template.category ?? 'imported', engines: ['any'], inputs: [...inputs.values()], prompt,
      models: { requires: ['t2i'], recommended: [template.model ?? 'gpt-image-2'], fallback: ['custom-image'] },
      generation: { count: { default: 1, max: 4 }, aspect: template.aspect ?? '1:1' }, checks: [], postprocess: [],
      output: { dir: '{{engine.assetRoot}}/generated', name: template.id } } } });
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, 'source-dir': { type: 'string' }, 'self-test': { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values['self-test']) {
    const sample = { id: 'pixel-icon', title: 'Game icon', prompt: 'Create {argument name="icon style" default="pixel"}' };
    const converted = PluginManifestSchema.parse(convertPromptTemplate(sample));
    assert.equal(converted.pixo?.recipe?.prompt, 'Create {{icon_style}}');
    assert.equal(converted.pixo?.recipe?.inputs[0]?.default, 'pixel');
    assert.equal(convertPromptTemplate({ ...sample, prompt: 'Mario game icon' }), null);
    assert.equal(convertPromptTemplate({ ...sample, title: 'Logo', id: 'logo', prompt: 'A corporate logo' }), null);
    console.log('Converter self-test passed'); return;
  }
  const target = values.out ?? positionals[0];
  if (values.help || !target) { console.log('node scripts/import-prompt-templates-to-recipes.ts <output-dir> [--source-dir <dir>] [--self-test]'); return; }
  const repo = path.resolve(import.meta.dirname, '..');
  const output = path.resolve(target);
  const curated = path.join(repo, 'plugins', '_official', 'recipes');
  const relative = path.relative(curated, output);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('Choose an output directory outside plugins/_official/recipes');
  const source = values['source-dir'] ? path.resolve(values['source-dir']) : path.join(repo, 'prompt-templates', 'image');
  let converted = 0;
  let skipped = 0;
  for (const name of (await readdir(source)).filter(name => name.endsWith('.json')).sort()) {
    const template = JSON.parse(await readFile(path.join(source, name), 'utf8')) as PromptTemplate;
    const manifest = convertPromptTemplate(template);
    if (!manifest) { skipped++; continue; }
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(template.id) || template.id.includes('..')) throw new Error('Invalid template id');
    const dir = path.join(output, template.id); await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'pixo.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' }); converted++;
  }
  console.log(JSON.stringify({ converted, skipped, output }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
