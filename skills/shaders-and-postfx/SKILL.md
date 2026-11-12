---
name: shaders-and-postfx
en_name: Game shaders and post-processing
zh_name: 游戏着色器与后处理
description: Integrate and profile shader effects in an existing Godot 4, Unity 6, Phaser 3 or Three.js game while preserving its renderer and art style; not for standalone graphics demos.
zh_description: 在已有 Godot 4、Unity 6、Phaser 3 或 Three.js 游戏中接入并测量着色器效果，保留既定渲染器与画风；不用于独立图形演示。
triggers:
  - game shader
  - outline shader
  - hit flash
  - dissolve effect
  - toon ramp
  - CRT post-processing
  - palette swap
  - URP Shader Graph
  - 游戏着色器
  - 游戏后处理
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
    - threejs
  category: game-development
---

# Game shaders and post-processing

Integrate effects into an existing Godot 4, Unity 6, Phaser 3 or Three.js game.
Project conventions, installed versions, architecture, renderer, art direction and explicit user choices take precedence.
Use the relevant engine branch; a local hit flash does not require a post-processing stack or dedicated test scene.
Keep damage and collision authority in gameplay; visual effects subscribe to those events.

## Quick path

1. Identify the visual goal, current materials and effects, renderer and target device.
2. Choose the smallest scope below; reuse the current material or effect stack where practical.
3. Expose useful controls for intensity, duration and disabling the effect. Preserve alpha, instance ownership and UI readability.
4. Compare the same scene and resolution with the effect off and on; measure cost when the effect adds meaningful work.
5. Run `pixo game verify --steps check --json` for Godot, `--steps check,build` for Unity or `--steps build` for web; inspect logs.
6. Inspect `pixo game playtest --preset observe --duration 10 --json` frames, then exercise the triggering event and restart interactively.

Commands assume `PIXO_PROJECT_ID`; otherwise add `--project <id>`.
Godot observation does not inject input; headless import does not prove target GPU behavior. Unity capture is unsupported, so look at the effect in the Game view or a player.

## Choose scope and algorithm

| Effect | Start with | Check |
| --- | --- | --- |
| Hit flash | Per-sprite tint or material envelope | Preserve base tint and alpha; only the hit actor changes |
| 2D outline | Neighbor alpha samples minus original mask | Texture and geometry padding; atlas-region clamping |
| Dissolve | Stable noise versus threshold | Explicit endpoints for fully present and fully absent states; collision remains gameplay-owned |
| Toon | Existing toon material or lighting ramp | Light direction, attenuation, color space and ramp filtering |
| CRT | World-camera or viewport pass | Readable HUD and subtitles, bounded distortion, option to disable or reduce motion |
| Palette swap | Index texture + palette lookup, or bounded RGB mapping | Nearest filtering and lossless index data, deliberate color space, alpha retained |

Local sprite or mesh work belongs on that object. Whole-view effects belong on a camera or viewport, with UI outside distortion when required.
Multiple outline or blur passes cost roughly pixels × samples × passes; high-DPI targets can multiply work.
Per-actor material copies can affect batching; measure the real crowd before applying them to hundreds of actors.

## Godot 4 anchors

Use `canvas_item` for 2D and `spatial` for 3D.
Check the installed minor and support in Compatibility, Mobile and Forward+ renderers before selecting features.
A Sprite2D or AnimatedSprite2D hit-flash ShaderMaterial can use:

```glsl
shader_type canvas_item;
uniform vec4 flash_color : source_color = vec4(1.0);
uniform float flash_amount : hint_range(0.0, 1.0) = 0.0;
void fragment() {
    // In Godot 4, fragment COLOR already includes texture and modulation.
    COLOR.rgb = mix(COLOR.rgb, flash_color.rgb, flash_amount);
}
```

For independent actors, give each visual an owned material before changing shared-resource uniforms.
This fragment assumes `visual` is the existing sprite and the shader above is assigned:

```gdscript
var flash_material: ShaderMaterial
var flash_tween: Tween

func prepare_flash() -> void:
    var source := visual.material as ShaderMaterial
    if source == null:
        push_error("Expected a hit-flash ShaderMaterial")
        return
    flash_material = source.duplicate() as ShaderMaterial
    visual.material = flash_material

func show_hit() -> void:
    if flash_material == null:
        return
    if flash_tween != null and flash_tween.is_valid():
        flash_tween.kill()
    flash_material.set_shader_parameter(&"flash_amount", 1.0)
    flash_tween = create_tween()
    flash_tween.tween_method(_set_flash, 1.0, 0.0, 0.08)

func _set_flash(amount: float) -> void:
    flash_material.set_shader_parameter(&"flash_amount", amount)
```

A screen pass typically uses a full-rect ColorRect with mouse filter Ignore:

```glsl
uniform sampler2D scene_color : hint_screen_texture, repeat_disable, filter_linear;
// In fragment(): texture(scene_color, SCREEN_UV)
```

Godot 4 uses `hint_screen_texture`; Godot 3's `SCREEN_TEXTURE` built-in is removed.
Screen-reading shaders can sample the same earlier copy; composing passes may require BackBufferCopy or a viewport chain.
For toon 3D, begin with the project's StandardMaterial3D toon modes; custom `light()` must handle actual light contributions.
References: [Godot 4.3 CanvasItem](https://docs.godotengine.org/en/4.3/tutorials/shaders/shader_reference/canvas_item_shader.html), [screen reading](https://docs.godotengine.org/en/4.3/tutorials/shaders/screen-reading_shaders.html); select the installed minor.

## Unity 6 anchors

Identify the pipeline first. `GraphicsSettings.currentRenderPipeline` is null on Built-in; otherwise it is a URP or HDRP asset. Shaders are not interchangeable across them, and a mismatch renders magenta. Prefer the project's Shader Graphs where they exist: use a Sprite Unlit or Sprite Lit target and set each property's Reference to the name scripts use. This hand-written URP version of the hit flash shows what that graph does:

```hlsl
Shader "Game/SpriteHitFlash"
{
    Properties
    {
        [PerRendererData] _MainTex ("Sprite", 2D) = "white" {}
        _FlashColor ("Flash color", Color) = (1, 1, 1, 1)
        _FlashAmount ("Flash amount", Range(0, 1)) = 0
    }
    SubShader
    {
        Tags { "RenderPipeline" = "UniversalPipeline" "Queue" = "Transparent" "RenderType" = "Transparent" }
        Blend SrcAlpha OneMinusSrcAlpha Cull Off ZWrite Off
        Pass
        {
            HLSLPROGRAM
            #pragma vertex Vert
            #pragma fragment Frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);
            CBUFFER_START(UnityPerMaterial)
                half4 _FlashColor;
                half _FlashAmount;
            CBUFFER_END
            struct Attributes { float4 position : POSITION; float2 uv : TEXCOORD0; half4 color : COLOR; };
            struct Varyings { float4 position : SV_POSITION; float2 uv : TEXCOORD0; half4 color : COLOR; };
            Varyings Vert(Attributes input)
            {
                Varyings output;
                output.position = TransformObjectToHClip(input.position.xyz);
                output.uv = input.uv;
                output.color = input.color; // SpriteRenderer.color.
                return output;
            }
            half4 Frag(Varyings input) : SV_Target
            {
                half4 color = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, input.uv) * input.color;
                color.rgb = lerp(color.rgb, _FlashColor.rgb, _FlashAmount);
                return color;
            }
            ENDHLSL
        }
    }
}
```

Drive one actor without touching the shared material. Fade `amount` from 1 to 0 with one owned coroutine or tween, stop the previous one on a repeat hit, and set 0 in `OnDisable`:

```csharp
private static readonly int FlashAmount = Shader.PropertyToID("_FlashAmount");
[SerializeField] private SpriteRenderer visual;
private MaterialPropertyBlock block;

private void SetFlash(float amount)
{
    block ??= new MaterialPropertyBlock();
    visual.GetPropertyBlock(block);
    block.SetFloat(FlashAmount, amount);
    visual.SetPropertyBlock(block);
}
```

- `SpriteRenderer.color` only multiplies, so it cannot reach white. That is why the flash needs a shader.
- `renderer.material` creates a copy that you must destroy. `renderer.sharedMaterial` edits the asset, and in the Editor that edit stays on disk. A property block avoids both, but it takes the renderer out of sprite batching and the SRP Batcher, so measure a real crowd.
- Whole-view effects in URP use a `Volume` with a profile (Bloom, Vignette, Color Adjustments), and the camera's Post Processing checkbox must be on. Change values through `volume.profile`, because `sharedProfile` writes to the asset.
- Custom CRT or palette passes: add a Full Screen Pass Renderer Feature to the renderer asset, with a Fullscreen Shader Graph. For code passes, Unity 6 URP uses `RecordRenderGraph`; older `Execute` and `cmd.Blit` samples target its compatibility path, so check the installed version.
- A Screen Space - Overlay canvas draws after post-processing, so the HUD stays undistorted. A Screen Space - Camera canvas is distorted unless a separate camera draws it.
- Dissolve: Shader Graph Alpha Clip with stable noise. Palette index textures: Point filter, no compression, sRGB off.
- `Shader.Find` returns null in a player when nothing references the shader, so stripping removes it. Reference a material or shader in a serialized field.
- A shader with a compile error does not fail the batch check: it exits 0, and the error may not reach the log. Open the shader's Inspector, or call `ShaderUtil.ShaderHasError(shader)` from an Editor script, then test on the target GPU.

## Phaser 3 and Three.js anchors

| Runtime | Correct path |
| --- | --- |
| Phaser 3, local flash | `sprite.setTintFill(0xffffff)`; restore prior tint through one owned timer |
| Phaser 3.60+ WebGL FX | Reuse built-in FX if they fit; Canvas requires a fallback |
| Phaser 3 custom post FX | Extend installed `Phaser.Renderer.WebGL.Pipelines.PostFXPipeline`; register with renderer `pipelines.addPostPipeline(key, Class)` |
| Attach or read per-object post FX | `sprite.setPostPipeline(key)`, `sprite.getPostPipeline(key)`; handle the returned instance or array as typed |
| Three.js WebGLRenderer | Existing EffectComposer → RenderPass → ShaderPass → OutputPass |
| Three.js WebGPURenderer | Installed node and post-processing path; WebGL addon shaders are not interchangeable |

For Phaser post shaders, use `uMainSampler` and `outTexCoord` from the installed pipeline contract; update resolution-dependent uniforms on resize.
Keep per-actor uniforms on the correct pipeline instance. Use a separate UI camera or Scene if world effects would distort controls.
`clearTint()` restores an untinted sprite, not an actor's custom base tint.
Reference: [Phaser 3.90 PostPipeline](https://docs.phaser.io/api-documentation/3.90.0/namespace/gameobjects-components-postpipeline).

For Three.js, import matching-version addons from `three/addons/postprocessing/*.js`.
ShaderPass normally binds the input texture to `tDiffuse`.
Render through `composer.render(deltaSeconds)` instead of also rendering the same view directly.
Resize the renderer and composer, and update custom texel uniforms together; apply output conversion once and dispose owned passes and targets.
Reference: [EffectComposer](https://threejs.org/docs/pages/EffectComposer.html); verify against the installed release.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Change a shared material uniform for one enemy | Own the material or instance parameters so other actors stay unchanged |
| Sample neighbors across an atlas cell edge | Clamp to the frame region and provide actual padding |
| Rely on disappearing pixels to disable damage | Let gameplay own collision and hit state |
| Stack timers or tweens on repeated hits | Replace or reset one owned envelope and restore the real base |
| Measure only average FPS in an empty scene | Compare frame time and worst normal load at the same resolution |

## Done when

- [ ] Transparent edges, overlaps, repeated triggers and resize preserve readability and independent actors.
- [ ] Disabling the effect restores the prior material and tint correctly; HUD and controls remain usable.
- [ ] Relevant cost with the effect on and off is measured; unavailable GPU or capture evidence is identified.
- [ ] Inspect `pixo game verify --steps check --json` (Godot), `--steps check,build` (Unity) or `--steps build` (web).
- [ ] Inspect `pixo game playtest --preset observe --duration 10 --json`, then use `pixo game run <projectId> --json` for event and restart checks that observation cannot cover.
