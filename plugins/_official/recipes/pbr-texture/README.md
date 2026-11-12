# Seamless PBR albedo

A seamless, shadowless base-color (albedo) map for a 3D material, resized and checked for seams.

One square albedo map at 512 or 1024 px with a seam score.

## Inputs

- `material` (string, required): Material
- `style` (select, default `realistic`): Style
- `resolution` (select, default `1024`): Resolution (px)
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `image`; model capability: `t2i`.
- Postprocess: `resize` → `seamless-check`.
- Checks: `seamless`, `dimensions`.
- Output: `{{engine.textureRoot}}/materials/{{name}}/{{name}}_albedo` (written only when you adopt a candidate).

## Notes

- Lighting baked into an albedo map fights the engine's lighting. Reject candidates with visible shadows or highlights even when the seam check passes.
- Godot: assign to `StandardMaterial3D.albedo_texture` and raise `uv1_scale` to tile. Three.js: `MeshStandardMaterial.map` with `wrapS = wrapT = RepeatWrapping` and `colorSpace = SRGBColorSpace`.

## CLI

```bash
pixo recipe run openpixo/pbr-texture --input "material=worn red brick wall" --input name=brick_red --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
