# Nine-slice UI element

A button, panel or frame designed so its corners stay fixed and its edges and center stretch cleanly, keyed to transparency and trimmed.

One trimmed, transparent sprite for one element and state. Run once per state (normal, hover, pressed, disabled) to build a full button.

## Inputs

- `element` (select, default `button`): Element
- `state` (select, default `normal`): State
- `theme` (string, required): Material and theme
- `style` (select, default `pixel art`): Art style
- `name` (string, required): File name (lowercase, no spaces)

## Pipeline

- Surface: `image`; model capability: `t2i`.
- Postprocess: `remove-bg` → `trim`.
- Checks: `has-alpha`.
- Output: `{{engine.uiRoot}}/{{name}}/{{name}}_{{state}}` (written only when you adopt a candidate).

## Notes

- Choosing the margins: open the adopted image and measure the corner ornament. A margin just larger than the corner decoration (often 20 to 30 percent of the shorter side) keeps corners crisp while edges stretch.
- Godot: `NinePatchRect` or a `StyleBoxTexture` with `texture_margin_*` set to that margin. Phaser 3.60+: `this.add.nineslice(x, y, key, frame, w, h, left, right, top, bottom)`.
- For matching states, keep the same theme text and style across runs, and use the adopted normal state as a reference where your model supports image input.

## CLI

```bash
pixo recipe run openpixo/ui-nine-slice --input element=panel --input "theme=weathered oak with iron rivets" --input name=panel_wood --json --wait
pixo recipe adopt <runId> --candidate <candidateId>
```

Inspect the candidates before adopting; checks flag obvious failures but do not judge whether the asset looks right.
