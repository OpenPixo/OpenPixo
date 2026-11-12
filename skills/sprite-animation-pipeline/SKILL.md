---
name: sprite-animation-pipeline
en_name: Sprite animation pipeline
zh_name: 精灵动画流水线
description: Import existing sprite sheets or ordered frames and fix slicing, atlas references, pivots or timing in Godot 4, Unity 6 or Phaser 3; not for generating art or skeletal rigs.
zh_description: 在 Godot 4、Unity 6 或 Phaser 3 中导入已有精灵表或有序帧，修复切图、图集引用、轴心与时长；不用于美术生成或骨骼绑定。
triggers:
  - sprite animation pipeline
  - spriteframes
  - animatedsprite2d
  - sprite atlas animation
  - Unity sprite animation
  - 精灵动画流水线
  - 精灵图集动画
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-assets
---

# Sprite animation pipeline

Import ordered frames or sheets into Godot 4, Unity 6 or Phaser 3. Fix animation timing, atlas references and pivots.
Project conventions, installed versions, architecture, art style and explicit user choices take precedence.
Keep a working sheet and format when the task only changes timing; slicing and repacking are optional.
This workflow uses existing art rather than generating new animation; new frames come from `pixo media generate --sheet <C>x<R> --frames` (the media section of the prompt), which writes them already on one canvas.

## Quick path

1. Inspect the selected sheet or frames with `pixo asset info <path> --json`; read current clip definitions.
2. Confirm cell size and order, clip ranges, baseline, pivot and timing for loops or one-shots. `pixo asset frames check <frames...> --json` measures the baseline and drift for you.
3. Choose the direct-sheet or pack branch below; read the operation's actual output paths.
4. Integrate through the engine's existing animation owner without moving gameplay collision.
5. Run `pixo game verify --steps check,build,run --screenshot --json`, inspect logs and frames, then watch a full loop and one-shot interactively.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.
Paths and frame counts below are examples; metadata-free sheets do not identify their own clips.
Unity has no `run` step or screenshot here: use `--steps check,build` and watch clips in the Editor.

## Choose the smallest format change

| Input or request | Choose | Preserve |
| --- | --- | --- |
| Working regular sheet, timing-only change | Existing SpriteFrames, Unity clip or Phaser sheet | Frame ranges, texture key, shared baseline |
| Regular grid needs separate frames | `pixo asset slice --cell WxH` or `--grid CxR` with an input path | Margin, spacing and expected coverage |
| Frames wobble, slide or differ in size | `pixo asset frames check`, then `frames align` | Input order, one scale for every frame |
| Ordered PNGs for Godot | `pack --format godot-tres` | Input order; keep PNG and TRES together |
| Ordered PNGs for Phaser | `pack --format texturepacker-json` | Input order, actual descriptor keys |
| Sheet or frames for Unity | Import as Sprite and slice in Unity; `pack` has no Unity output | Pivot, Pixels Per Unit, existing `.meta` |
| Trimmed frames with custom pivots | Existing metadata-aware pipeline | Trim offsets and pivots; image-only packing cannot recover them |

Record only relevant contract fields: canvas and cell size, row-major order, clip ranges, FPS, frame holds, looping and the baseline for feet.
Equal-sized canvases with a shared anchor avoid frame-to-frame wobble; opaque bounds are not the pivot.

## Slicing and packing anchors

```sh
pixo asset slice public/assets/player.png --cell 32x32 --out derived/player-frames --dry-run --json
pixo asset slice public/assets/player.png --cell 32x32 --out derived/player-frames --json
pixo asset pack sprites/run/frame-0000.png sprites/run/frame-0001.png --format godot-tres --padding 1 --out derived/run-godot --json
pixo asset pack public/sprites/run/frame-0000.png public/sprites/run/frame-0001.png --format texturepacker-json --padding 1 --out public/atlases/run --json
```

Use the slice report's returned PNG paths; the two-frame pack commands only illustrate ordering.
`--grid` requires exact division after margin and spacing; `--cell` may leave incomplete edge cells unused.
Check full coverage and frame count. Deliberately exclude empty cells and frames from other clips.
Read `results`, `extraOutputs`, `reportPath`, failures and `originalsPreserved`; existing destinations are skipped.

Packer facts:
- Stem derives from the first input and retains its relative directories beneath `--out`; read paths rather than guessing.
- Outputs are `<stem>.atlas.png` plus `.atlas.tres` or `.atlas.json`.
- Packing may rearrange spatial placement but descriptors preserve input order.
- No rotation, trim, edge extrusion, clip naming or custom pivots are generated.
- Padding is transparent separation, not duplicated edge pixels.

## Check and align frames

```sh
pixo asset frames check public/assets/hero/hero-run-1.png public/assets/hero/hero-run-2.png public/assets/hero/hero-run-3.png --json
pixo asset frames align public/assets/hero/hero-run-*.png --canvas 64x64 --padding 1 --out derived/hero-run --json
```

Pass frames in play order (a shell glob sorts `-10` before `-2`; list them when there are ten or more).
`frames check` writes no images. Per frame, `results[].detail` has the drawn `bounds`, `bottomGap` (rows under the feet), `feetX` (centre of the lowest rows, which a swung weapon does not move), `empty` and `touchesEdge`.
`summary` judges the set: `baselineSpreadPx` (feet bobbing), `feetXSpreadPx` (sliding), `heightDriftPercent`, `emptyFrames`, `edgeFrames` and one plain sentence per problem in `issues`; `ok` is true when there are none.
A crouch, squash or jump changes height on purpose; the same pose at different heights is model drift.

`frames align` writes each frame to `<out>/<input path>.png` on one canvas: feet on one line `padding` above the bottom, `feetX` on the centre line, one scale for all so a crouch stays shorter than a stand.
`--canvas WxH` scales every frame by the same factor to fit; without it the canvas is the smallest that holds them all.
`--match-height` first scales each drawing to the median height, for drift only. `--filter nearest` keeps pixel art crisp.
Its `summary` re-checks the aligned frames. Existing outputs are skipped, as with every asset operation.

## Godot 4: SpriteFrames timing

`godot-tres` emits SpriteFrames format=3 with a looping `default` clip at 5 FPS.
Keep PNG and TRES together; the texture reference is relative. Import new images via `pixo game verify --steps check --json`.

After substituting the reported path, this adapts an actual four-frame clip:

```gdscript
func configure_run(sprite: AnimatedSprite2D) -> void:
    var packed := load("res://sprites/run/run.atlas.tres") as SpriteFrames
    if packed == null or packed.get_frame_count(&"default") != 4:
        push_error("Expected four run frames")
        return
    var frames := packed.duplicate() as SpriteFrames
    frames.rename_animation(&"default", &"run")
    frames.set_animation_speed(&"run", 10.0)
    frames.set_animation_loop(&"run", true)
    frames.set_frame(&"run", 0, frames.get_frame_texture(&"run", 0), 2.0)
    sprite.sprite_frames = frames
    sprite.centered = true
    sprite.offset = Vector2(0, -16) # Example: bottom-center anchor on a 32px canvas.
    sprite.play(&"run")
```

Frame duration `2.0` means twice the normal frame duration, not two seconds.
Use the agreed baseline for offset; keep CharacterBody2D and CollisionShape2D stable.
One-shot clips need loop=false; connect `animation_finished` once and gate the transition by the active animation.
Reference: [Godot 4.3 SpriteFrames](https://docs.godotengine.org/en/4.3/classes/class_spriteframes.html).

## Phaser 3: sheet or atlas timing

```ts
// preload(), for an actual 32px sheet:
this.load.spritesheet('player', 'assets/player.png', { frameWidth: 32, frameHeight: 32 });
// create(), with the project's real run range:
if (!this.anims.exists('player-run')) {
  this.anims.create({ key: 'player-run',
    frames: this.anims.generateFrameNumbers('player', { start: 2, end: 5 }),
    frameRate: 10, repeat: -1 });
}
player.setOrigin(0.5, 1).play('player-run', true);
```

Vite public assets load without `public/` in the URL.
For atlases, `this.load.atlas(key, pngUrl, jsonUrl)` loads the returned pair.
TexturePacker hash keys are the input project-relative paths; read them or `getFrameNames()`.
Use an explicit ordered list when names do not encode order.

```ts
// orderedNames comes from the reviewed descriptor/clip list.
this.anims.create({ key: 'hero-run', frameRate: 10, repeat: -1,
  frames: orderedNames.map((frame, index) => ({
    key: 'hero-atlas', frame, duration: index === 0 ? 100 : 0,
  })),
}); // At 10 FPS, 100 extra ms holds the first frame for 200 ms total.
```

Guard global animation creation with `this.anims.exists` as above; keys survive Scene restarts.
`repeat: 0` plays once; use an owned one-shot completion listener.
Changing origin affects body placement; inspect size and offset rather than moving collision to hide a bad pivot.
Reference: [Phaser 3.90 animation types](https://docs.phaser.io/api-documentation/3.90.0/typedef/types-animations).

## Unity 6: importer, clip and Animator

Unity reads neither `godot-tres` nor TexturePacker JSON without an extra package. Put the sheet under `Assets/`, then set Texture Type Sprite, Sprite Mode Multiple and the real Pixels Per Unit. For pixel art, add Point filter and no compression. Slice by cell size in the Sprite Editor, with a shared pivot such as Bottom. Scripted slicing goes through `ISpriteEditorDataProvider` from `SpriteDataProviderFactories`; `TextureImporter.spritesheet` is the old path. `com.unity.2d.aseprite` imports `.aseprite` files directly, with clips, when the art starts there.

Clips can be made by selecting sprites and dropping them in the Animation window, or from a script when there are many. This Editor-only example builds a four-frame looping clip and holds the first frame:

```csharp
using System;
using System.Linq;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

public static class HeroClips
{
    [MenuItem("Tools/Create Hero Run Clip")]
    public static void CreateRun()
    {
        const float frame = 0.1f; // 10 FPS.
        // LoadAllAssetsAtPath has no promised order, and hero_10 sorts before hero_2 as text.
        var sprites = AssetDatabase.LoadAllAssetsAtPath("Assets/Art/hero.png").OfType<Sprite>()
            .OrderBy(sprite => int.Parse(Regex.Match(sprite.name, @"\d+$").Value))
            .Skip(2).Take(4).ToArray();
        if (sprites.Length != 4) throw new InvalidOperationException("Expected four run frames");
        var keys = sprites.Select((sprite, index) => new ObjectReferenceKeyframe {
            time = index == 0 ? 0f : (index + 1) * frame, value = sprite,
        }).ToArray();
        var clip = new AnimationClip { frameRate = 1f / frame };
        AnimationUtility.SetObjectReferenceCurve(clip,
            EditorCurveBinding.PPtrCurve("", typeof(SpriteRenderer), "m_Sprite"), keys);
        var settings = AnimationUtility.GetAnimationClipSettings(clip);
        settings.loopTime = true;
        settings.stopTime = (sprites.Length + 1) * frame;
        AnimationUtility.SetAnimationClipSettings(clip, settings);
        AssetDatabase.CreateAsset(clip, "Assets/Animations/hero_run.anim");
    }
}
```

Key times are seconds, so a hold is a wider gap between keys. Set `stopTime` so the last frame gets its full length.

- In the Animator, sprite transitions usually want Has Exit Time off and Transition Duration 0, or the next pose arrives late.
- `animator.Play(hash)` leaves a state that is already playing alone, so calling it every update is safe. Replaying a one-shot needs `Play(hash, 0, 0f)`. Hash names once with `Animator.StringToHash`.
- Detect a one-shot's end with an Animation Event, or check `normalizedTime >= 1` while `IsInTransition(0)` is false and the state hash matches. A transition can otherwise report the old state.
- Put the Animator and SpriteRenderer on a child, with the Rigidbody2D and collider on the root, and turn Apply Root Motion off. `flipX` does not flip colliders or child objects, and it mirrors about the pivot, so an off-center pivot jumps.
- Tight sprite meshes can clip effects drawn over the frame; use Full Rect when a shader samples beyond the outline.
- A Sprite Atlas batches separately imported frames. Give it padding, and turn off Tight Packing and Allow Rotation for pixel art.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Sort unpadded filenames lexicographically | Explicit order; frame-10 otherwise precedes frame-2 |
| Trim each frame independently | Keep canvas or valid offsets so feet stay planted |
| Guess packed basenames | Read descriptor keys and returned output paths |
| Use the same duration unit in every engine | Godot uses relative multipliers, Phaser frame duration adds milliseconds, Unity keys are seconds |
| Call `play(key)` every update | `play(key, true)` avoids restarting an already active clip |
| Let visual clip speed change damage or physics implicitly | Keep gameplay timing authoritative unless explicitly coupled |

## Done when

- [ ] Actual frame count, frame order, clip timing, looping and one-shot behavior match the request.
- [ ] Feet and pivots remain stable through transitions between idle and run, mirroring and restart; `pixo asset frames check` reports `ok` for each state, or its remaining issues are deliberate.
- [ ] Atlas references and load paths are real; visual changes preserve collision behavior.
- [ ] Use `pixo game run <projectId> --json`, or the Editor on Unity, to watch complete loops and one-shot completion; a still image cannot prove timing. Report tested timings and unresolved issues.
- [ ] Inspect `pixo game verify --steps check,build,run --screenshot --json`, including resource errors and skipped steps.
