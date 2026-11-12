// Daemon-side mirror of src/media/models.ts. The two files are kept in sync by hand — any model added to
// src/media/models.ts must be added here too. Drift is enforced by
// `node scripts/verify-media-models.mjs` (also exposed as
// `npm run verify:media-models`); CI should call it before publish so
// the moment one side adds a model and the other doesn't, the build
// fails with a precise diff.

import { canonicalMediaModelId as canonicalCatalogModelId } from '@openpixo/contracts';

/**
 * Ids the media gateway's models were saved under before they got neutral ones.
 * Daemon only, so the web bundle never carries the old names; recipes, saved
 * settings and scripted callers using them keep resolving here.
 */
const RENAMED_GATEWAY_MODELS: Readonly<Record<string, string>> = Object.freeze({
  'flux-dev-fal': 'flux-dev-gateway',
  'flux-schnell-fal': 'flux-schnell-gateway',
  'ideogram-v3-fal': 'ideogram-v3-gateway',
  'recraft-v3-fal': 'recraft-v3-gateway',
  'veo-3-fal': 'veo-3-gateway',
  'seedance-1-pro-fal': 'seedance-1-pro-gateway',
  'kling-2.1-t2v-fal': 'kling-2.1-t2v-gateway',
  'veo-2-fal': 'veo-3-gateway',
});

/** Same for credentials saved in media-config.json. */
export const RENAMED_MEDIA_PROVIDERS: Readonly<Record<string, { id: string; defaultBaseUrl: string }>> = Object.freeze({
  fal: { id: 'media-gateway', defaultBaseUrl: 'https://fal.run' },
});

export function canonicalMediaModelId(id: string): string {
  return canonicalCatalogModelId(Object.hasOwn(RENAMED_GATEWAY_MODELS, id) ? RENAMED_GATEWAY_MODELS[id]! : id);
}

export type MediaSurface = 'image' | 'video' | 'audio' | 'model3d';
export type AudioKind = 'music' | 'speech' | 'sfx';

export type MediaProvider = {
  id: string;
  label: string;
  hint: string;
  integrated: boolean;
  defaultBaseUrl?: string;
  docsUrl?: string;
  credentialsRequired?: boolean;
  settingsVisible?: boolean;
  supportsCustomModel?: boolean;
  customModelPlaceholder?: string;
};

export type MediaModel = {
  id: string;
  label: string;
  hint: string;
  provider: string;
  caps: string[];
  default?: boolean;
};

export const MEDIA_PROVIDERS: MediaProvider[] = [
  { id: 'codex-cli', label: 'Codex (ChatGPT sign-in)', hint: 'image_gen · ChatGPT sign-in', integrated: true, credentialsRequired: false },
  // Hosted by OpenPixo and paid with credits: needs a sign-in and a confirmed quote, never an API key.
  { id: 'openpixo', label: 'OpenPixo cloud (credits)', hint: 'Hosted image, audio and 3D generation paid with OpenPixo credits', integrated: true, credentialsRequired: false, settingsVisible: false },
  { id: 'openai', label: 'OpenAI', hint: 'gpt-image-2 / dall-e-3', integrated: true, defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'volcengine', label: 'Volcengine Ark (Doubao)', hint: 'Seedance 2.0 / Seedream', integrated: true, defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'grok', label: 'xAI Grok Imagine', hint: 'grok-imagine — image + video with native audio', integrated: true, defaultBaseUrl: 'https://api.x.ai/v1' },
  { id: 'hyperframes', label: 'HyperFrames', hint: 'Local HTML -> MP4 renderer', integrated: true, credentialsRequired: false, settingsVisible: false },
  { id: 'nanobanana', label: 'Nano Banana', hint: 'Uses Google’s official API by default. You can also configure a custom gateway.', integrated: true, defaultBaseUrl: 'https://generativelanguage.googleapis.com', supportsCustomModel: true },
  { id: 'imagerouter', label: 'ImageRouter', hint: 'OpenAI-compatible image + video routing', integrated: true, defaultBaseUrl: 'https://api.imagerouter.io/v1/openai', docsUrl: 'https://docs.imagerouter.io/api-reference/image-generation/', supportsCustomModel: true, customModelPlaceholder: 'openai/gpt-image-2 or xAI/grok-imagine-video' },
  { id: 'openrouter', label: 'OpenRouter', hint: 'Unified gateway for image + video models', integrated: true, credentialsRequired: true, settingsVisible: true, defaultBaseUrl: 'https://openrouter.ai/api/v1', docsUrl: 'https://openrouter.ai/settings/keys' },
  { id: 'custom-image', label: 'Custom Image API', hint: 'OpenAI-compatible images/generations + images/edits (local or cloud)', integrated: true, docsUrl: 'https://platform.openai.com/docs/api-reference/images', supportsCustomModel: true, customModelPlaceholder: 'my-image-model' },
  { id: 'comfyui', label: 'ComfyUI', hint: 'Local JSON workflow server (planned adapter)', integrated: false, defaultBaseUrl: 'http://127.0.0.1:8188', docsUrl: 'https://docs.comfy.org/development/core-concepts/workflow' },
  { id: 'bfl', label: 'Black Forest Labs', hint: 'FLUX 1.1 Pro / Dev / Schnell / Kontext', integrated: false, defaultBaseUrl: 'https://api.bfl.ai' },
  // The user's own fal key. This catalogue reaches every CLI and agent, so it stays neutral; only the web catalogue's Settings entry shows the name.
  { id: 'media-gateway', label: 'Media gateway', hint: 'FLUX / Sora / Veo / Wan / Ideogram / Recraft / Tripo / Meshy', integrated: true, supportsCustomModel: true },
  { id: 'leonardo', label: 'Leonardo.ai', hint: 'Phoenix / Kino XL / FLUX', integrated: true, credentialsRequired: true, settingsVisible: true, defaultBaseUrl: 'https://cloud.leonardo.ai/api/rest/v1' },
  { id: 'replicate', label: 'Replicate', hint: 'FLUX / SDXL / Ideogram', integrated: false, defaultBaseUrl: 'https://api.replicate.com' },
  { id: 'google', label: 'Google AI / Vertex', hint: 'Imagen 4 / Veo 3 / Lyria', integrated: false },
  { id: 'kling', label: 'Kuaishou Kling', hint: 'Kling 2.0 video', integrated: false },
  { id: 'midjourney', label: 'Midjourney (proxy)', hint: 'midjourney-v7', integrated: false },
  { id: 'minimax', label: 'MiniMax', hint: 'TTS / image-01 / video-01', integrated: true, defaultBaseUrl: 'https://api.minimaxi.chat/v1' },
  { id: 'suno', label: 'Suno', hint: 'Music generation', integrated: false },
  { id: 'udio', label: 'Udio', hint: 'Music generation', integrated: false },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    hint: 'Voice / SFX',
    integrated: true,
    defaultBaseUrl: 'https://api.elevenlabs.io',
    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
  },
  { id: 'fishaudio', label: 'FishAudio', hint: 'Speech / voice clone', integrated: true, defaultBaseUrl: 'https://api.fish.audio' },
  {
    id: 'senseaudio',
    label: 'SenseAudio',
    hint: '',
    integrated: true,
    defaultBaseUrl: 'https://api.senseaudio.cn',
    docsUrl: 'https://docs.senseaudio.cn',
  },
  {
    id: 'aihubmix',
    label: 'AIHubMix',
    hint: 'OpenAI-compatible aggregator · image + speech',
    integrated: true,
    credentialsRequired: true,
    settingsVisible: true,
    defaultBaseUrl: 'https://aihubmix.com/v1',
    docsUrl: 'https://docs.aihubmix.com',
    supportsCustomModel: true,
    customModelPlaceholder: 'gpt-image-2 or dall-e-3',
  },
  { id: 'tavily', label: 'Tavily Search', hint: 'Agent-callable web research', integrated: true, defaultBaseUrl: 'https://api.tavily.com' },
  { id: 'stub', label: 'Stub (placeholder)', hint: 'Deterministic local placeholder bytes', integrated: true },
];

export const IMAGE_MODELS: MediaModel[] = [
  { id: 'gpt-image-2', label: 'gpt-image-2', hint: 'OpenAI · 4K, native multimodal', provider: 'openai', caps: ['t2i', 'i2i', 'inpaint'] },
  { id: 'dall-e-3', label: 'dall-e-3', hint: 'OpenAI · classic', provider: 'openai', caps: ['t2i'] },
  { id: 'doubao-seedream-3-0-t2i-250415', label: 'seedream-3.0', hint: 'ByteDance · Doubao image', provider: 'volcengine', caps: ['t2i'] },
  { id: 'doubao-seededit-3-0-i2i-250628', label: 'seededit-3.0', hint: 'ByteDance · image edit', provider: 'volcengine', caps: ['i2i'] },

  { id: 'senseaudio-image-2.0-260319', label: 'senseaudio-image-2.0', hint: 'SenseAudio · multi-aspect, latest', provider: 'senseaudio', caps: ['t2i', 'i2i'] },
  { id: 'doubao-seedream-5-0-260128', label: 'seedream-5.0', hint: 'SenseAudio · ByteDance Seedream 5.0 hi-res', provider: 'senseaudio', caps: ['t2i', 'i2i'] },

  // AIHubMix routes these to OpenAI's images/generations endpoint. Ids are
  // prefixed to stay unique against the openai-provider entries above; the
  // `aihubmix-` prefix is stripped to the real wire name in media.ts.
  { id: 'aihubmix-gpt-image-1', label: 'gpt-image-1 (AIHubMix)', hint: 'AIHubMix · OpenAI gpt-image-1', provider: 'aihubmix', caps: ['t2i', 'i2i'] },
  { id: 'aihubmix-dall-e-3', label: 'dall-e-3 (AIHubMix)', hint: 'AIHubMix · OpenAI DALL·E 3', provider: 'aihubmix', caps: ['t2i'] },

  { id: 'minimax-image-01', label: 'image-01', hint: 'MiniMax · text + image-to-image', provider: 'minimax', caps: ['t2i', 'i2i'] },

  { id: 'grok-imagine-image', label: 'grok-imagine-image', hint: 'xAI · 2K text-to-image', provider: 'grok', caps: ['t2i'] },

  { id: 'gemini-3.1-flash-image-preview', label: 'nano-banana-2', hint: 'Nano Banana · text-to-image', provider: 'nanobanana', caps: ['t2i'] },

  { id: 'openai/gpt-image-2', label: 'openai/gpt-image-2', hint: 'ImageRouter · routed GPT Image', provider: 'imagerouter', caps: ['t2i'] },
  { id: 'black-forest-labs/FLUX-1.1-pro', label: 'FLUX-1.1-pro', hint: 'ImageRouter · Black Forest Labs', provider: 'imagerouter', caps: ['t2i'] },

  { id: 'openrouter/google/gemini-2.5-flash-image', label: 'gemini-flash-image (OR)', hint: 'OpenRouter · Gemini', provider: 'openrouter', caps: ['t2i'] },
  { id: 'openrouter/black-forest-labs/flux-1.1-pro', label: 'flux-1.1-pro (OR)', hint: 'OpenRouter · BFL', provider: 'openrouter', caps: ['t2i'] },
  { id: 'openrouter/recraft/recraft-v3', label: 'recraft-v3 (OR)', hint: 'OpenRouter · Recraft', provider: 'openrouter', caps: ['t2i'] },

  { id: 'custom-image', label: 'custom-image', hint: 'Custom · OpenAI-compatible endpoint', provider: 'custom-image', caps: ['t2i', 'i2i'] },

  { id: 'flux-1.1-pro', label: 'flux-1.1-pro', hint: 'BFL · flagship', provider: 'bfl', caps: ['t2i', 'i2i'] },
  { id: 'flux-dev', label: 'flux-dev', hint: 'BFL · open weights', provider: 'bfl', caps: ['t2i'] },
  { id: 'flux-schnell', label: 'flux-schnell', hint: 'BFL · fast', provider: 'bfl', caps: ['t2i'] },
  { id: 'flux-kontext-pro', label: 'flux-kontext-pro', hint: 'BFL · in-context edits', provider: 'bfl', caps: ['t2i', 'i2i'] },

  { id: 'imagen-4', label: 'imagen-4', hint: 'Google · latest', provider: 'google', caps: ['t2i'] },
  { id: 'gemini-3-pro-image-preview', label: 'gemini-3-pro-image', hint: 'Google · Nano Banana Pro', provider: 'google', caps: ['t2i', 'i2i'] },

  { id: 'ideogram-v2', label: 'ideogram-v2', hint: 'Replicate · typography', provider: 'replicate', caps: ['t2i'] },
  { id: 'sdxl', label: 'stable-diffusion-xl', hint: 'Replicate · SDXL', provider: 'replicate', caps: ['t2i'] },

  { id: 'flux-pro-ultra', label: 'flux-pro-ultra', hint: 'Media gateway · FLUX 1.1 Pro Ultra · highest quality (~60–180s)', provider: 'media-gateway', caps: ['t2i'] },
  { id: 'flux-dev-gateway', label: 'FLUX Dev', hint: 'Media gateway · FLUX Dev · balanced quality/speed (~15–40s)', provider: 'media-gateway', caps: ['t2i'] },
  { id: 'flux-schnell-gateway', label: 'FLUX Schnell', hint: 'Media gateway · FLUX Schnell · fastest (~3–8s)', provider: 'media-gateway', caps: ['t2i'] },
  { id: 'ideogram-v3-gateway', label: 'ideogram-v3', hint: 'Media gateway · Ideogram v3 · typography + design (~15–30s)', provider: 'media-gateway', caps: ['t2i'] },
  { id: 'recraft-v3-gateway', label: 'recraft-v3', hint: 'Media gateway · Recraft v3 · vector + illustration (~15–30s)', provider: 'media-gateway', caps: ['t2i'] },
  { id: 'sd-3.5', label: 'stable-diffusion-3.5', hint: 'Media gateway · SD 3.5 (~20–40s)', provider: 'media-gateway', caps: ['t2i'] },

  { id: 'leonardo-phoenix', label: 'Phoenix', hint: 'Leonardo · versatile', provider: 'leonardo', caps: ['t2i'] },
  { id: 'leonardo-kino-xl', label: 'Kino XL', hint: 'Leonardo · cinematic', provider: 'leonardo', caps: ['t2i'] },
  { id: 'leonardo-flux-dev', label: 'FLUX Dev', hint: 'Leonardo · FLUX', provider: 'leonardo', caps: ['t2i'] },
  { id: 'leonardo-flux-schnell', label: 'FLUX Schnell', hint: 'Leonardo · fast', provider: 'leonardo', caps: ['t2i'] },
  { id: 'leonardo-anime-pastel', label: 'Anime Pastel Dream', hint: 'Leonardo · anime', provider: 'leonardo', caps: ['t2i'] },

  { id: 'midjourney-v7', label: 'midjourney-v7', hint: 'Midjourney · via proxy', provider: 'midjourney', caps: ['t2i'] },
  { id: 'codex-image', label: 'codex-image', hint: 'Codex · ChatGPT sign-in', provider: 'codex-cli', caps: ['t2i', 'i2i'] },
  { id: 'openpixo-image', label: 'OpenPixo image', hint: 'OpenPixo cloud · credits · GPT Image 2.5 Flare', provider: 'openpixo', caps: ['t2i'] },
  { id: 'openpixo-image-edit', label: 'OpenPixo image edit', hint: 'OpenPixo cloud · credits · GPT Image 2.5 Flare edit', provider: 'openpixo', caps: ['i2i'] },
];

export const VIDEO_MODELS: MediaModel[] = [
  { id: 'doubao-seedance-2-0-260128', label: 'seedance-2.0', hint: 'ByteDance · t2v + i2v + audio', provider: 'volcengine', caps: ['t2v', 'i2v', 'audio'], default: true },
  { id: 'doubao-seedance-2-0-fast-260128', label: 'seedance-2.0-fast', hint: 'ByteDance · faster, cheaper', provider: 'volcengine', caps: ['t2v', 'i2v', 'audio'] },

  { id: 'grok-imagine-video', label: 'grok-imagine-video', hint: 'xAI · 720p t2v + i2v + native audio', provider: 'grok', caps: ['t2v', 'i2v', 'audio'] },

  // OpenRouter video models.
  { id: 'openrouter/bytedance/seedance-2.0:1080p', label: 'seedance-2.0 1080p (OR)', hint: 'OpenRouter · ByteDance · 1080p', provider: 'openrouter', caps: ['t2v', 'i2v'], default: true },
  { id: 'openrouter/bytedance/seedance-2.0', label: 'seedance-2.0 720p (OR)', hint: 'OpenRouter · ByteDance · 720p', provider: 'openrouter', caps: ['t2v', 'i2v'] },
  { id: 'openrouter/bytedance/seedance-2.0:480p', label: 'seedance-2.0 480p (OR)', hint: 'OpenRouter · ByteDance · 480p', provider: 'openrouter', caps: ['t2v', 'i2v'] },
  { id: 'openrouter/google/veo-3.1', label: 'veo-3.1 (OR)', hint: 'OpenRouter · Google', provider: 'openrouter', caps: ['t2v', 'i2v', 'audio'] },
  { id: 'openrouter/alibaba/wan-2.7', label: 'wan-2.7 (OR)', hint: 'OpenRouter · Alibaba', provider: 'openrouter', caps: ['t2v', 'i2v'] },
  { id: 'openrouter/kwaivgi/kling-v3.0-pro', label: 'kling-v3.0-pro (OR)', hint: 'OpenRouter · Kuaishou', provider: 'openrouter', caps: ['t2v', 'i2v'] },

  { id: 'xAI/grok-imagine-video', label: 'xAI/grok-imagine-video', hint: 'ImageRouter · routed video', provider: 'imagerouter', caps: ['t2v', 'audio'] },
  { id: 'bytedance/seedance-1.5-pro', label: 'seedance-1.5-pro', hint: 'ImageRouter · Bytedance', provider: 'imagerouter', caps: ['t2v'] },
  { id: 'google/veo-3.1-lite', label: 'veo-3.1-lite', hint: 'ImageRouter · Google', provider: 'imagerouter', caps: ['t2v'] },

  { id: 'kling-2.0', label: 'kling-2.0', hint: 'Kuaishou · latest', provider: 'kling', caps: ['t2v', 'i2v'] },

  { id: 'veo-3', label: 'veo-3', hint: 'Google · sound-on', provider: 'google', caps: ['t2v', 'audio'] },

  { id: 'veo-3-gateway', label: 'Veo 3', hint: 'Media gateway · Google Veo 3 · sound-on', provider: 'media-gateway', caps: ['t2v', 'audio'] },
  { id: 'wan-2.1-t2v', label: 'wan-2.1-t2v', hint: 'Media gateway · Wan 2.1 text-to-video', provider: 'media-gateway', caps: ['t2v'] },
  { id: 'wan-2.1-i2v', label: 'wan-2.1-i2v', hint: 'Media gateway · Wan 2.1 image-to-video', provider: 'media-gateway', caps: ['i2v'] },
  { id: 'seedance-1-pro-gateway', label: 'Seedance 1 Pro', hint: 'Media gateway · Seedance 1 Pro', provider: 'media-gateway', caps: ['t2v', 'i2v'] },
  { id: 'kling-2.1-t2v-gateway', label: 'Kling 2.1', hint: 'Media gateway · Kling 2.1 Pro text-to-video', provider: 'media-gateway', caps: ['t2v'] },
  { id: 'sora-2', label: 'sora-2', hint: 'Media gateway · OpenAI Sora 2', provider: 'media-gateway', caps: ['t2v'] },
  { id: 'sora-2-pro', label: 'sora-2-pro', hint: 'Media gateway · OpenAI Sora 2 Pro', provider: 'media-gateway', caps: ['t2v'] },

  { id: 'minimax-video-01', label: 'video-01', hint: 'MiniMax · Hailuo', provider: 'minimax', caps: ['t2v', 'i2v'] },
  { id: 'hyperframes-html', label: 'hyperframes-html', hint: 'HyperFrames · local HTML renderer', provider: 'hyperframes', caps: ['t2v'] },
];

export const AUDIO_MODELS_BY_KIND: Record<AudioKind, MediaModel[]> = {
  music: [
    { id: 'suno-v5', label: 'suno-v5', hint: 'Suno · default', provider: 'suno', caps: ['music'], default: true },
    { id: 'udio-v2', label: 'udio-v2', hint: 'Udio', provider: 'udio', caps: ['music'] },
    { id: 'lyria-2', label: 'lyria-2', hint: 'Google', provider: 'google', caps: ['music'] },
    { id: 'openpixo-music', label: 'OpenPixo music', hint: 'OpenPixo cloud · credits · instrumental', provider: 'openpixo', caps: ['music'] },
  ],
  speech: [
    { id: 'minimax-tts', label: 'minimax-tts', hint: 'MiniMax', provider: 'minimax', caps: ['tts'], default: true },
    { id: 'fish-speech-2', label: 'fish-speech-2', hint: 'FishAudio', provider: 'fishaudio', caps: ['tts', 'voice-clone'] },
    { id: 'elevenlabs-v3', label: 'elevenlabs-v3', hint: 'ElevenLabs', provider: 'elevenlabs', caps: ['tts', 'voice-clone'] },
    { id: 'senseaudio-tts', label: 'senseaudio-tts', hint: 'SenseAudio', provider: 'senseaudio', caps: ['tts', 'voice-clone'] },
    { id: 'doubao-tts', label: 'doubao-tts', hint: 'Volcengine', provider: 'volcengine', caps: ['tts'] },
    { id: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', hint: 'OpenAI', provider: 'openai', caps: ['tts'] },
    { id: 'aihubmix-tts-1', label: 'tts-1 (AIHubMix)', hint: 'AIHubMix · OpenAI tts-1', provider: 'aihubmix', caps: ['tts'] },
    // xAI TTS — multilingual; uses the same SuperGrok OAuth as image / video.
    { id: 'grok-tts', label: 'grok-tts', hint: 'xAI · multilingual · uses Grok subscription', provider: 'grok', caps: ['tts'] },
    { id: 'openpixo-voice', label: 'OpenPixo voice', hint: 'OpenPixo cloud · credits · voice lines', provider: 'openpixo', caps: ['tts'] },
  ],
  sfx: [
    { id: 'elevenlabs-sfx', label: 'elevenlabs-sfx', hint: 'ElevenLabs SFX', provider: 'elevenlabs', caps: ['sfx'], default: true },
    { id: 'audiocraft', label: 'audiocraft', hint: 'Meta · open', provider: 'replicate', caps: ['sfx', 'music'] },
    { id: 'openpixo-sfx', label: 'OpenPixo sound effect', hint: 'OpenPixo cloud · credits · up to 10 s', provider: 'openpixo', caps: ['sfx'] },
  ],
};

/** One image in, one textured GLB out. Hosted first: most people have no 3D key. */
export const MODEL3D_MODELS: MediaModel[] = [
  { id: 'openpixo-model3d', label: 'OpenPixo 3D model', hint: 'OpenPixo cloud · credits · medium quality, the default', provider: 'openpixo', caps: ['image-to-3d'] },
  { id: 'openpixo-model3d-draft', label: 'OpenPixo 3D model (draft)', hint: 'OpenPixo cloud · credits · cheapest, a quick rough model', provider: 'openpixo', caps: ['image-to-3d'] },
  { id: 'openpixo-model3d-high', label: 'OpenPixo 3D model (high)', hint: 'OpenPixo cloud · credits · detailed shape and textures, costs the most', provider: 'openpixo', caps: ['image-to-3d'] },
  { id: 'tripo-v2.5-gateway', label: 'Tripo v2.5', hint: 'Media gateway · textured GLB, up to 30,000 faces', provider: 'media-gateway', caps: ['image-to-3d'], default: true },
  { id: 'meshy-6-gateway', label: 'Meshy 6', hint: 'Media gateway · textured GLB with PBR maps, costs more', provider: 'media-gateway', caps: ['image-to-3d'] },
];

/**
 * The audio kind of an OpenPixo hosted model. Hosted audio models each make one
 * kind, so the id alone says which; null for anything else.
 */
export function hostedAudioKind(id: unknown): AudioKind | null {
  if (typeof id !== 'string') return null;
  for (const kind of ['music', 'speech', 'sfx'] as const) {
    if (AUDIO_MODELS_BY_KIND[kind].some((model) => model.id === id && model.provider === 'openpixo')) return kind;
  }
  return null;
}

/**
 * What one hosted audio request may send. The cloud refuses a style on anything but
 * speech and a duration on anything but sound effects, and it binds a quote to exactly
 * these values, so the quote and the generate must both read them from here.
 */
export function hostedAudioParams(kind: AudioKind, input: { style?: unknown; voice?: unknown; duration?: unknown }): { style?: string; duration?: number } {
  const style = kind === 'speech' ? input.style || input.voice : undefined;
  return {
    ...(typeof style === 'string' && style ? { style } : {}),
    ...(kind === 'sfx' && typeof input.duration === 'number' ? { duration: input.duration } : {}),
  };
}

/** The one surface an OpenPixo hosted model makes, so a mismatch is refused before anything is priced. */
export function hostedModelSurface(id: unknown): 'image' | 'audio' | 'model3d' {
  if (hostedAudioKind(id)) return 'audio';
  return MODEL3D_MODELS.some((model) => model.id === id && model.provider === 'openpixo') ? 'model3d' : 'image';
}

export const MEDIA_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
export const VIDEO_LENGTHS_SEC = [3, 5, 8, 10, 15, 30];
export const AUDIO_DURATIONS_SEC = [5, 10, 15, 30, 60, 120];


export function findMediaModel(id: string): MediaModel | null {
  const all = [
    ...IMAGE_MODELS,
    ...VIDEO_MODELS,
    ...AUDIO_MODELS_BY_KIND.music,
    ...AUDIO_MODELS_BY_KIND.speech,
    ...AUDIO_MODELS_BY_KIND.sfx,
    ...MODEL3D_MODELS,
  ];
  const canonicalId = canonicalMediaModelId(id);
  return all.find((m) => m.id === canonicalId) || null;
}

/** A text-to-image model by its id or an older saved id: what `agentImageModel` may name. */
export function findTextToImageModel(id: unknown): MediaModel | null {
  if (typeof id !== 'string' || !id.trim()) return null;
  const canonicalId = canonicalMediaModelId(id.trim());
  return IMAGE_MODELS.find((m) => m.id === canonicalId && m.caps.includes('t2i')) ?? null;
}

export function findProvider(id: string): MediaProvider | null {
  return MEDIA_PROVIDERS.find((p) => p.id === id) || null;
}

export function modelsForSurface(surface: MediaSurface, audioKind?: AudioKind): MediaModel[] {
  if (surface === 'image') return IMAGE_MODELS;
  if (surface === 'video') return VIDEO_MODELS;
  if (surface === 'model3d') return MODEL3D_MODELS;
  if (surface === 'audio') {
    const k = audioKind || 'music';
    return AUDIO_MODELS_BY_KIND[k] || AUDIO_MODELS_BY_KIND.music;
  }
  return [];
}
