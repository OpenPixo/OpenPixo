# Image

Any image from a description, optionally from up to three reference pictures, in the project's art style.

This is the plain image recipe behind the generator's 图片 tab: the prompt is the user's text, and the project art style is merged in as for every image recipe.

## Inputs

- `prompt` (text, required): Description
- `reference`, `reference2`, `reference3` (image-ref): Reference pictures
- `aspect` (aspect, default `1:1`): Shape
- `transparent` (boolean, default `false`): Transparent background
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `image`; any image model, the edit service when a reference is given.
- A transparent background is asked of the model; a model without alpha paints a key colour that is keyed out.
- Output: `{{engine.assetRoot}}/images/{{name}}` (written only when you adopt a candidate).

## CLI

```bash
pixo recipe run openpixo/image --input prompt="a closed wooden treasure chest" --input transparent=true --input name=treasure_chest --wait --json
```
