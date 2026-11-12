import type { MediaGenerationRequest } from '@openpixo/contracts';

export const CODEX_IMAGE_CLI_STRING_FLAGS = ['provider', 'count', 'background', 'negative-prompt'];
interface Flags {
  model?: string;
  provider?: string;
  count?: string;
  background?: string;
  'negative-prompt'?: string;
}
export function codexImageCliModel(flags: Flags): string | undefined {
  return flags.model || (flags.provider === 'codex-cli' ? 'codex-image' : undefined);
}
export function codexImageCliRequestOptions(flags: Flags): Pick<MediaGenerationRequest, 'provider' | 'count' | 'background' | 'negativePrompt'> {
  return {
    ...(flags.provider ? { provider: flags.provider } : {}),
    ...(flags.count !== undefined ? { count: Number(flags.count) } : {}),
    ...(flags.background === 'transparent' || flags.background === 'scene' ? { background: flags.background } : {}),
    ...(flags['negative-prompt'] ? { negativePrompt: flags['negative-prompt'] } : {}),
  };
}
export const CODEX_IMAGE_CLI_HELP = [
  '  --provider codex-cli      Use Codex (ChatGPT sign-in), without a media API key.',
  '                            Defaults --model to codex-image. Uses your Codex plan allowance.',
  '  --count <1-4>             Codex image count (default 1).',
  '  --background transparent|scene',
  '  --negative-prompt <text>  Content to avoid in generated images.',
].join('\n');
