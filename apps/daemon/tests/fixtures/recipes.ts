import { PluginManifestSchema, type RecipeDetail } from '@openpixo/contracts';

export function recipeManifest() {
  return { name: 'openpixo/test-sprite', title: 'Test sprite', version: '0.1.0', pixo: { kind: 'recipe', recipe: {
    surface: 'image', category: 'character', engines: ['any'],
    inputs: [{ name: 'style', type: 'text', default: 'pixel' }, { name: 'reference', type: 'image-ref' }],
    prompt: '{{style}} sprite', models: { requires: ['t2i'], recommended: ['recipe-test-stub'], fallback: [] },
    generation: { count: { default: 2, max: 4 }, aspect: '1:1' },
    postprocess: [{ op: 'resize', params: { width: 32, height: 32 } }, { op: 'slice', params: { grid: '2x2' } }],
    checks: [{ check: 'dimensions', params: { width: 64, height: 64 } }],
    output: { dir: '{{engine.spriteRoot}}/hero', name: 'hero' },
  } } };
}
export function recipeDetail(): RecipeDetail {
  const manifest = PluginManifestSchema.parse(recipeManifest());
  return { id: 'test-sprite', title: 'Test sprite', description: '', version: '0.1.0', surface: 'image', category: 'character', engines: ['any'], requires: ['t2i'], manifest };
}
