---
name: game-assets-batch
en_name: Game asset batch processing
zh_name: 游戏素材批处理
description: "Batch-process selected game images or audio with deterministic OpenPixo asset tools, preserving originals and reporting actual outputs. Use for resize, slice, atlas or audio transforms; not media generation."
zh_description: "使用 OpenPixo 确定性素材工具批量处理选定的游戏图片或音频，保留原文件并报告实际输出；适用于缩放、切图、图集或音频变换，不用于媒体生成。"
triggers:
  - game asset batch
  - batch image resize
  - batch audio normalize
  - slice sprite sheet
  - pack texture atlas
  - 游戏素材批处理
  - 批量处理图片
  - 批量处理音频
  - 切精灵图
  - 打图集
license: Apache-2.0
pixo:
  mode: utility
  category: game-development
  design_system:
    requires: false
  example_prompt: Normalize the selected sound effects to -16 LUFS as OGG copies, preserve the originals, and report each result.
  example_prompt_i18n:
    zh-CN: 把选中的音效统一到 -16 LUFS 并输出 OGG 副本，保留原文件，并逐项报告结果。
---

# Game asset batch processing

The user's selected files, requested transform and the project's asset conventions take precedence. Use `pixo asset` for supported operations; a small explicit batch can run directly without a separate planning artifact.

## Quick path

1. Resolve selected project-relative inputs with `pixo asset info <rel-path> --json`; `pixo asset list --kind image --json` helps locate named assets.
2. Confirm the few parameters that affect the result: size or grid, transparency, loudness, format and destination. Infer only from explicit task or project evidence.
3. Run one operation over those inputs. Use `--dry-run --json` first for large or uncertain batches.
4. Read the real JSON report, including all output paths and each input that failed or was skipped; inspect images or listen to audio.
5. Chain only successful relevant outputs into the next operation; report counts, preservation result and produced paths.

Commands inherit `PIXO_PROJECT_ID`; otherwise add `--project <id>`. Inputs and `--out` are project-relative. Resolve attachments to actual project files; report inputs that are external or have not been imported rather than guessing their index paths.

## Concrete examples

Illustrative paths must be replaced with the selected inputs:

```text
pixo asset resize art/hero.png art/enemy.png --scale 2 --filter nearest --json
pixo asset slice art/walk.png --grid 6x8 --json
pixo asset audio normalize audio/hit.wav audio/jump.wav --lufs -16 --json
```

Normalization produces WAV. If OGG was requested, feed the returned successful WAV paths into `pixo asset audio convert <inputs...> --format ogg --json`. A normalize target is explicit: “normalize” alone may mean peak or loudness normalization, so resolve that ambiguity before processing.

## Operation decisions

All processing commands accept input paths plus `--out <rel-dir>`, `--dry-run` and `--json`.

| Operation after `pixo asset` | Supported parameters and decisions |
| --- | --- |
| `resize` | `--width`, `--height` or `--scale`; `--filter nearest` for pixel art, `lanczos` for smooth resampling. Supplying both dimensions can distort aspect ratio |
| `trim` | `--padding <px>`; crops transparent borders, so check sprite pivots afterward |
| `slice` | Exactly one of `--grid CxR` or `--cell WxH`; optional `--margin` and `--spacing` |
| `pack` | `--max-size`, `--padding`, `--format texturepacker-json` or `--format godot-tres` |
| `export-spritesheet` | Equal-sized animation frames: `--format godot` or `--format phaser`, `--columns`, `--animations`, `--fps`; inspect `--help` for other formats |
| `pixelate` | Exactly one of `--size` (low-resolution longest side) or `--pixel-size` (block size); optional `--palette`; optional dithering with `--dither none` or `ordered` |
| `palette` | `--colors N` writes GPL and HEX; `--apply` also writes a quantized image copy |
| `seamless-check` | Writes edge score and tiled preview; does not repair seams |
| `remove-bg` | `--mode chroma --color RRGGBB --tolerance N`. Model-based removal is deferred |
| `audio normalize` | `--lufs <target>`; inspect the result for the intended loudness and clipping |
| `audio trim` | `--silence-threshold <dB>` |
| `audio loop` | `--crossfade-ms <ms>`; crossfade changes duration, so audition the loop seam |
| `audio convert` | `--format wav`, `ogg` or `mp3`; optional `--sample-rate <Hz>` |

Inspect the declared grid, loop and engine metadata with `info` before choosing parameters. `pixo asset provenance <rel-path> --json` can explain whether an asset was generated or processed. Preserve engine `.meta` and `.import` metadata and references unless the task includes updating them.

**Unity projects:** set `--out` under `Assets/`, since the Editor ignores files elsewhere and writes the new `.meta` on its next import. Replacing an existing file in place keeps its `.meta`, so references and import settings survive. A new derived file starts with default import settings, so a sprite needs its Texture Type, Pixels Per Unit, filter and compression set. `pack` and `export-spritesheet` have no Unity format, so use `slice` or a whole sheet with the steps in sprite-animation-pipeline.

## Reports and chaining

- The report contains `results[]`, `counts`, `originalsPreserved` and, for real runs, `reportPath`. Inspect each result's `status`, `error`, `output` and `extraOutputs`; hashes record preservation and produced files.
- A dry run may mark a planned result `succeeded` while `dryRun` is true. It creates neither transformed files nor a saved report.
- **Slice's primary `output` is its JSON manifest.** Frame PNGs are additional outputs; pass the reported frames, in intended order, to pack or spritesheet export rather than passing the manifest as an image.
- Atlas PNG and descriptor are a pair. Godot `godot-tres` creates a `SpriteFrames` resource, not a TileSet or generic atlas importer; the default animation is `default` at 5 FPS.
- Existing outputs are skipped. Choose a new explicit destination for a requested retry; removing a prior output to force a rerun risks losing work.
- A failed batch can still contain successful independent files. Report partial success accurately; a nonzero exit is not permission to claim nothing happened or silently switch tools.

## Local fallback, only when needed

If the operation or format is unsupported or the CLI is unavailable, state the limitation and use an existing project tool when it covers the request. Do not install a new processing stack just to bypass a failed supported command.

- Probe the actual executable and version. FFmpeg, ImageMagick or another installed tool may fit; an app dependency need not be resolvable from a game directory.
- Pass literal argv to handle spaces and shell metacharacters. For FFmpeg, `-nostdin -n` prevents prompts and overwriting.
- Hash readable originals before and after. Write new derived files via temporary siblings; validate before publishing without replacement.
- Preserve full source-relative paths under the chosen derived directory to avoid basename collisions. Continue independent inputs after failures.
- Save one per-input report for a fallback batch: parameters, tool and version, source and output paths with hashes, status, exit code, and the reason for each error or skip. Do not modify sources or pre-existing reports.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Sweep every asset for a selected-file request | Process the selected or named set only |
| Guess grid or flatten alpha | Inspect metadata and resolve ambiguity; lost frames or alpha are irreversible in a derived export |
| Pack slice's manifest | Select reported frame PNGs and preserve their animation order |
| Treat a dry-run report as processed files | Check `dryRun`, then execute and inspect real outputs |
| Claim perfect normalization from exit status | Listen to and measure the output; encoding and short clips can affect the result |

## Done when

- [ ] Ran the requested operation with the real parameters; examined all statuses and preservation checks.
- [ ] Outputs are readable and match requirements for dimensions, grid and alpha, or for format, duration and loudness.
- [ ] Linked actual derived files and report; named inputs that were skipped or failed and any unavailable operation.
- [ ] If game references changed, run `pixo game verify --steps check --json` for Godot or Unity, or `pixo game verify --steps build --json` for web, with the same project selection.
