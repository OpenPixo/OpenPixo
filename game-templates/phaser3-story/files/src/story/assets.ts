/** Where the story's pictures and sounds go, by name. Shared by the game and the story check. */
export const ASSET_FOLDERS = {
  background: 'assets/backgrounds',
  portrait: 'assets/characters',
  music: 'assets/music',
  sound: 'assets/sfx',
} as const;
export const IMAGE_TYPES = ['png', 'webp', 'jpg'] as const;
export const AUDIO_TYPES = ['ogg', 'mp3', 'wav'] as const;
