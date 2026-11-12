# 3D model from image

Turns one reference image of a prop or character into a textured 3D model (GLB). Needs a provider with image-to-3D support.

One textured 3D model file in the format the provider returns (usually GLB).

## Inputs

- `image` (image-ref, required): Reference image
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `model3d`; model capability: `image-to-3d`.
- Postprocess: none.
- Checks: none.
- Output: `{{engine.modelRoot}}/{{name}}/{{name}}` (written only when you adopt a candidate).

## Notes

- Recipes run on your own media gateway key. With credits and no key, use the hosted 3D service in Library > Generate, or `pixo media generate --surface model3d --model openpixo-model3d --image <path>` (medium quality; `openpixo-model3d-draft` and `openpixo-model3d-high` are the cheaper and the more detailed tiers).
- Use a reference with one object, a plain background and a three-quarter view. `character-turnaround` output works well for characters.
- Models are capped at 30,000 faces. Check scale in the engine before shipping.

## CLI

```bash
pixo recipe run openpixo/model-from-image --input image=art/props/chest.png --input name=treasure_chest --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
