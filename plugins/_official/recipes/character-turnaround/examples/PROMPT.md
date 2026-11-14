# character-turnaround examples

Made by running this recipe once through `pixo recipe run` with Codex image generation on 2026-11-14,
then reviewed by eye. The card shows the file named below; nothing was retouched.

- `examples/knight-before.webp`: recipe image run `567ed0f5-941e-4dac-8f60-e334baccddbc`, staged `primary.png`; inputs `{"prompt": "a young knight with a red scarf and a small round shield, full body, standing, game character, plain light background", "aspect": "1:1", "transparent": true, "name": "knight"}`
- `examples/knight-after.webp`: recipe character-turnaround run `33a9466b-5b28-4380-9abf-6b4aa6487826`, staged `derived/1-trim/derived/0-remove-bg/primary.png`; inputs `{"character": "knight", "views": "front, side and back", "style": "match the reference images"}`
