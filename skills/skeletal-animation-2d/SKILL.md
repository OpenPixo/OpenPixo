---
name: skeletal-animation-2d
en_name: 2D skeletal and cutout animation
zh_name: 2D 骨骼与分件动画
description: Prepare existing layered character art or integrate Spine, DragonBones, Godot 4 Skeleton2D or Unity 2D Animation rigs with preserved pivots and runtime metadata; not for frame animation or character generation.
zh_description: 整理已有分层角色美术或接入 Spine、DragonBones、Godot 4 Skeleton2D 或 Unity 2D Animation 骨架，保留轴心与运行时元数据；不用于逐帧动画或角色生成。
triggers:
  - 2D skeletal animation
  - cutout animation
  - Spine animation
  - DragonBones
  - Godot Skeleton2D
  - Unity 2D Animation
  - rig hand-painted character
  - 2D 骨骼动画
  - 手绘角色分件
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
  category: game-assets
---

# 2D skeletal and cutout animation

Prepare or integrate articulated characters from existing parts or rigs.
Project conventions, installed versions, architecture, art style and explicit user choices take precedence.
Use the relevant path below; an attachment or pivot fix does not require a new rig, manifest or complete animation set.
Frame animation remains suitable for drawn turns or deformations the available parts cannot represent.

## Quick path

1. Inspect the actual source layers or export, engine version, rig editor, runtime and requested motion.
2. Choose a proven compatible runtime before authoring or re-exporting; test its smallest existing sample.
3. Fix the relevant pivots, hidden-joint coverage, rest pose or weights; test extreme bends before more clips.
4. Export all required skeleton files and atlas pages with metadata intact, then integrate with existing gameplay ownership.
5. Run `pixo game verify --steps check --json` for Godot, `--steps check,build` for Unity or `--steps build` for web; inspect logs.
6. Inspect `pixo game playtest --preset observe --duration 10 --json` where supported, then test movement, attacks and restart interactively.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.
Godot capture observes only; browser automation does not imply native-runtime support; Unity has no capture, so test in the Editor or a player.

## Choose a compatible path

| Path | Use when | Establish first |
| --- | --- | --- |
| Godot 4 Skeleton2D with Bone2D | Godot owns rig and animation | Rest pose, part hierarchy, Polygon2D weights if deforming |
| Unity 2D Animation | Unity owns rig and animation | Installed `com.unity.2d.animation` and `com.unity.2d.psdimporter`, bind pose, weights |
| Spine | Existing integration, or requested features for authoring or runtime | Matching major and minor versions for editor, export and runtime; support for the engine and backend, license and native libraries |
| DragonBones | Existing assets or a proven integration | Exact exporter and runtime revisions; current sample for the renderer and platform actually runs |
| Existing rigid cutout hierarchy | Only independent part rotation or attachments are needed | Stable pivots and draw order; meshes or IK may be unnecessary |

Check [Spine version management](https://en.esotericsoftware.com/spine-versioning) and the actual [runtime](https://en.esotericsoftware.com/spine-runtimes).
The runtime license is separate from this skill's Apache license.
For [DragonBonesJS](https://github.com/DragonBones/DragonBonesJS), inspect the pinned integration's support and maintenance; an old demo does not establish current compatibility with Phaser, Pixi or Godot.

## Parts and pivots

Keep the layered master intact. Split only parts that need independent motion.
A front-view illustration does not supply hidden side views; identify turning limits before promising a full rotation.

| Part | Pivot and overlap check |
| --- | --- |
| Pelvis and torso | Hip and waist overlap under clothing |
| Upper arm, lower arm and hand | Shoulder, elbow and wrist; hidden coverage through maximum bend |
| Thigh, calf and foot | Hip, knee and ankle; stable contact anchor |
| Head, hair and prop | Neck or attachment anchor; deliberate draw order |

- Reconstruct covered joint artwork so rotation does not expose holes.
- Preserve silhouette, brush grain, light direction and edge softness; overlapping dark outlines can create seams.
- Keep attachment names stable. Preserve parent and local transforms and draw order.
- Retain trim offsets and pivots across format boundaries. Use existing rig notes and metadata; create a manifest only if the pipeline needs it.
- Test at native and target scale over contrasting and in-game backgrounds.
- Inspect source dimensions and origin with `pixo asset info <path> --json` and `pixo asset provenance <path> --json`.
- `pixo asset slice <path> --cell 32x32 --out derived/parts --json` slices a regular grid; it does not identify semantic limbs. Irregular cutouts need the existing workflow for the layered editor or masking.

## Godot 4 native anchor

A typical visual subtree, adapted to the project's existing ownership:

```text
CharacterBody2D
├─ CollisionShape2D
└─ Visual (Node2D)
   ├─ Skeleton2D
   │  └─ Hip (Bone2D) → limb chains
   ├─ Polygon2D (deforming part, skeleton points to Skeleton2D)
   └─ AnimationPlayer
```

- For Polygon2D deformation, assign its `skeleton` NodePath and map Bone2D paths and weights in the polygon editor.
- Save rest transforms after the hierarchy and pivots are correct; a changed bind pose requires rechecking weights.
- For rigid parts, parent Sprite2D under bones or animate the established Node2D hierarchy.
- Keep physics shapes outside visual squash and deformation so animation cannot silently change collision.
- Use AnimationPlayer or AnimationTree as the project already does; a skeleton alone does not define clips.
- Reference: [Godot 4.3 2D skeletons](https://docs.godotengine.org/en/4.3/tutorials/animation/2d_skeletons.html); select the installed minor.

## Unity 6 native anchor

A typical subtree from a `.psb` imported with the PSD Importer (Mosaic and Character Rig on):

```text
Player (Rigidbody2D, Collider2D)
└─ Visual (Animator)
   ├─ bones (Transforms from the Skinning Editor)
   └─ parts (SpriteRenderer + SpriteSkin)
```

- Keep the `.psb` as the layered source; Unity imports it in place. Deleting and re-creating a layer can lose that part's rig data, so edit existing layers.
- Build bones and weights in the Skinning Editor (Sprite Editor → Skinning Editor), and recheck weights after changing the bind pose.
- `SpriteSkin` deforms each part. With `com.unity.burst` and `com.unity.collections` installed, deformation runs far cheaper; measure a crowd either way.
- IK comes from `IKManager2D` with Limb or Chain solvers. Set the bend direction with the Limb solver's Flip option, and watch for flips at full extension.
- Sprite Library with `SpriteResolver` swaps attachments and skins without changing the rig, so keep category and label names stable.
- Put the Animator on `Visual`, with physics on the root, so animation cannot move collision. Keep Apply Root Motion off unless the project uses it. For event-driven actions, set Culling Mode to Always Animate, or off-screen characters stop firing events.
- Spine in Unity uses the `spine-unity` runtime matching the editor's major and minor. It expects `.skel.bytes` or `.json`, `.atlas.txt` and the PNG pages, so check premultiplied-alpha settings against the material. `pack` does not produce any of these.

For new clips, idle plus one locomotion cycle is enough to test runtime viability first.
Check planted feet, stride versus speed, blend transitions, one-shot endings and IK bend direction.
Use meshes around joints or silhouette changes; rigid props should remain rigid.

## Export and gameplay integration

| Export | Files and integration checks |
| --- | --- |
| Spine | Skeleton JSON or binary, atlas and every page; match runtime, alpha mode, filtering, padding and rotation support |
| DragonBones | Often `*_ske.json`, `*_tex.json`, `*_tex.png`; use the pinned factory or armature sample |
| Godot native | Scene, resources, animations, textures and import sidecars with real resource references |
| Unity native | `.psb`, Sprite Library, animation clips and controller, with their `.meta` files |

Use the rig editor's atlas exporter when it owns attachment offsets, meshes or rotated regions.
`pixo asset pack` packs image or frame atlases; it does not create skeletons or preserve arbitrary rig metadata.
For Spine use the installed [spine-godot](https://en.esotericsoftware.com/spine-godot) or [spine-phaser](https://en.esotericsoftware.com/spine-phaser) integration and validate each shipped platform's libraries.
Smoke-test mesh, clipping, IK and events before relying on advanced runtime features.

Drive clips from gameplay state and locomotion speed. Animation events can replay through blends, restarts or rollback:
consume action events once per action ID and keep authoritative damage timing in gameplay.
Unsubscribe owned events and dispose runtime objects on shutdown; multiple actors need independent animation state.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Import any skeleton JSON into Godot or Unity directly | Use its compatible runtime or native resources; JSON is only a container |
| Trim parts and recenter each PNG | Preserve offsets and pivots so joints do not drift |
| Author a full animation set before runtime testing | Import a minimal rig and clip first; exporter and runtime mismatches are costly |
| Assume mirroring works for asymmetric art | Supply deliberate variants or preserve asymmetry |
| Repack a Spine atlas with an image-only packer | Keep rig exporter metadata and page references intact |
| Trust an editor preview as platform proof | Test the exported runtime and native libraries on each intended target |

## Done when

- [ ] Requested joints and clips survive extreme poses, transitions, mirroring and target-scale inspection.
- [ ] Foot contact, draw order, atlas pages and alpha look correct; actors and events remain independent.
- [ ] Relevant editable sources, pivots, clip and event names, and export and runtime versions are handed off.
- [ ] Use `pixo game run <projectId> --json` for action and restart checks where supported; report missing editors, licenses or runtimes, and identify untested export targets.
- [ ] Inspect `pixo game verify --steps check --json` (Godot), `--steps check,build` (Unity) or `--steps build` (web).
