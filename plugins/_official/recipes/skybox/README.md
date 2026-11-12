# Equirectangular skybox

A 360-degree equirectangular sky panorama resized to 2048x1024 for a sky sphere or panorama sky material.

One 2048x1024 equirectangular image. Providers generate 16:9, so the result is stretched horizontally by about 12 percent to reach 2:1, which is not noticeable in skies.

## Inputs

- `scene` (string, required): Sky
- `timeOfDay` (select, default `midday`): Time of day
- `style` (select, default `stylized painterly`): Style
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `image`; model capability: `t2i`.
- Postprocess: `resize`.
- Checks: `dimensions`.
- Output: `{{engine.textureRoot}}/sky/{{name}}` (written only when you adopt a candidate).

## Notes

- Godot: `WorldEnvironment` → `Sky` → `PanoramaSkyMaterial.panorama`. Three.js: load the texture with `mapping = EquirectangularReflectionMapping` and assign it to `scene.background`.
- Look at the left/right join and the top edge before adopting; pinching at the zenith is the most common defect.

## CLI

```bash
pixo recipe run openpixo/skybox --input "scene=scattered clouds over a calm ocean" --input timeOfDay=sunset --input name=sky_sunset --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
