import type { InstalledPluginRecord } from '@openpixo/contracts';

interface PreviewLike {
  entry?: unknown;
}

interface ContextLike {
  assets?: unknown;
}

interface ExampleOutputLike {
  path?: unknown;
}

export function canDuplicatePluginPreview(record: InstalledPluginRecord): boolean {
  const pixo = record.manifest?.pixo as
    | {
        preview?: PreviewLike;
        context?: ContextLike;
        useCase?: { exampleOutputs?: unknown };
      }
    | undefined;
  if (!pixo) return false;
  if (isHtmlRelativePath(pixo.preview?.entry)) return true;
  const assets = Array.isArray(pixo.context?.assets) ? pixo.context.assets : [];
  if (assets.some(isHtmlRelativePath)) return true;
  const examples = Array.isArray(pixo.useCase?.exampleOutputs)
    ? pixo.useCase.exampleOutputs as ExampleOutputLike[]
    : [];
  return examples.some((example) => isHtmlRelativePath(example.path));
}

function isHtmlRelativePath(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = normalizeRelativePath(value);
  return normalized !== null && /\.html?$/i.test(normalized);
}

function normalizeRelativePath(value: string): string | null {
  if (!value || value.includes('\0')) return null;
  const withSlashes = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (withSlashes.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(withSlashes)) return null;
  const segments: string[] = [];
  for (const segment of withSlashes.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') return null;
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join('/') : null;
}
