# 生成 kind covers

Pictures for each kind on the 生成 page: a sound, voice or 3D result with no picture of its own shows its kind's cover (`components/generate/GenerateHistory.tsx`), and an empty 我的作品 shows three of them.

- `sfx.webp`, `music.webp`, `voice.webp`, `model3d.webp`: made with OpenAI image generation through Codex for OpenPixo (2026-11-14), 3:2, resized to 960x640 webp. Each prompt asked for a polished stylized 3D render on a deep violet-black ground (#0C0A13), the subject to one side and dark space at the bottom left for the title, with no text, logos or UI:
  - sfx: a sword striking a wooden shield, an orange and cyan impact burst, sound-wave rings, coins popping up.
  - music: a cosy village on a floating island at night, a lute and a synth keyboard, pink and violet music ribbons.
  - voice: a friendly goblin shopkeeper mid-sentence at a counter, empty amber speech bubbles, potions.
  - model3d: a hand-drawn dragon card turning into a 3D model on a turntable, wireframe across its tail.
- `image.webp`: composed from the image presets' own examples (`plugins/_official/recipes/{skybox,item-icon-set,character-turnaround,vfx-sequence}/examples/`), fanned on the same ground.
