# Agent image generation: size, transparency and what a generation leaves behind

The agent in a game project generates art on its own when the work needs it
(sprites, tiles, icons, backgrounds), picks a final size for how the asset is
used, and asks for real transparency when the asset is a cutout. This page is
the contract for that path: the request shape, how the daemon shapes the
pixels, and exactly which events and files one generation produces, so the
chat UI can show results inline.

Prompt wording lives in `packages/contracts/src/prompts/media-contract.ts`
(`### When to make art, and at what size`); read
[prompt-composition.md](prompt-composition.md) before changing it.

## Request

One shape for every caller: `MediaGenerationRequest` in
`packages/contracts/src/api/media.ts`, sent to
`POST /api/projects/:id/media/generate` (UI, user CLI) or
`POST /api/tools/media/generate` (agent tool token).

| Field | Meaning |
| --- | --- |
| `width`, `height` | Final pixel size of the written image. Images only. One side alone keeps `aspect` (default 1:1). |
| `background: 'transparent'` | The written file is a PNG with real alpha, on every provider. |
| `background: 'scene'` | A full scene; no cutout. |
| `aspect` | Still accepted. With a size it is replaced by the aspect nearest to `width:height` (reported as a warning). |

CLI, same fields: `pixo media generate --surface image --size 64 --transparent ...`,
`--size 1536x864`, or `--width 320 [--height 180]`. `--transparent` is the short
form of `--background transparent`. Size flags on a non-image surface exit 2.

### Size rule

`resolveImageOutputSize` (contracts) is the only rule, shared by the daemon, CLI
and any UI preview:

- No `width`/`height`: the provider's default size stands; nothing is resized.
- Long edge capped at `IMAGE_OUTPUT_MAX_EDGE` = 1536 px; larger requests shrink
  proportionally (e.g. 3840x2160 becomes 1536x864) and the clamp is reported in
  `file.warnings`. Edges below `IMAGE_OUTPUT_MIN_EDGE` = 16 px are raised.
- Not a positive integer, or an unknown `aspect`: `400 BAD_REQUEST` before any
  task is created.
- The provider is asked for the nearest of 1:1, 16:9, 9:16, 4:3, 3:4 at its native
  resolution; the daemon then resizes to the exact size. Opaque images use cover
  (centre crop); transparent images are trimmed to the subject and contained.
  Projects whose art style has a pixel grid resample nearest-neighbour.

### Transparency

`apps/daemon/src/media/image-output.ts` handles alpha the same way for every
provider. If the delivered image already has transparent borders, that alpha
is kept (`alpha: 'native'`). Otherwise the daemon flood-fills the flat backdrop
from the image border and makes it transparent, with a feathered edge
(`alpha: 'keyed'`). Pixels inside the subject that match the backdrop color
stay opaque unless they connect to the border.

| Provider path | What it is asked for |
| --- | --- |
| Codex `image_gen` (`codex-image`) | Real alpha, with a flat key-color backdrop as fallback; final size as a composition hint. |
| BYOK image APIs (OpenAI-compatible, Nano Banana, Fal, ...) | A flat `#FF00FF` backdrop (`#00FF00` when the prompt names pink/purple), explicitly not a checkerboard; final size hint. The provider never receives an unsupported `background` parameter. |
| OpenPixo hosted (`openpixo-*`) | Nothing changes in the quoted request. The verified delivery is reshaped locally after download, which costs no credits. |

Only an explicit request makes a cutout. A project art style whose default
background is transparent still steers the prompt only, so a scene generated
without `--transparent` keeps its sky.

## What one generation produces

In order, for one `pixo media generate` an agent runs:

1. **Agent tool call.** A command-tool `tool_use` whose command contains
   `media generate` (detected by `MEDIA_GENERATE_RE` in
   `apps/web/src/runtime/chat/build-turn-blocks.ts`). Size flags are visible
   in that command string (`--size 64 --transparent`).
2. **Dispatch.** `POST /api/tools/media/generate` answers
   `202 {taskId, status, startedAt}`. The task row carries the run's `runId`.
3. **Task snapshots.** `GET /api/projects/:id/media/tasks?includeDone=1` lists
   `ProjectMediaTask` records (`runId`, `batchId/batchIndex/batchSize`, `status`,
   `progress`). `GET /api/media/tasks/:taskId/wait` long-polls one task.
4. **The file.** Written at the project-relative `file.name` inside the asset
   root the agent chose with `--output`. With a size or `--transparent` the
   extension becomes `.png` whatever the request named. Preview through
   `projectRawUrl(projectId, file.name)`.
5. **Done snapshot.** `task.file` (also the CLI's last stdout line,
   `{"file": {...}}`, inside the agent's `tool_result`):

   ```json
   {
     "name": "assets/icons/coin.png", "size": 5123, "mtime": 1762130000000,
     "kind": "image", "mime": "image/png",
     "width": 64, "height": 64, "transparent": true,
     "warnings": [], "model": "gpt-image-2", "surface": "image",
     "providerId": "openai", "providerNote": "openai/gpt-image-2 · 1:1 · ...",
     "assetProvenance": {
       "contentHash": "<sha256 of the written bytes>", "provider": "openai",
       "model": "gpt-image-2", "promptText": "A gold coin icon",
       "params": { "aspect": "1:1", "width": 64, "height": 64,
         "requestedWidth": 64, "requestedHeight": 64,
         "background": "transparent", "alpha": "keyed" },
       "referenceHashes": []
     }
   }
   ```

   `width`/`height` are the written file's size; `transparent` appears only
   when a cutout was requested. A Codex task with `--count` > 1 adds `files[]`
   with the same fields per image. `promptText` is the request prompt (after the
   art-style merge), not the provider-specific additions.
6. **Chat snapshot.** The final bytes (after resize and cutout) are frozen as a
   chat artifact snapshot tied to `runId` and `mediaTaskId`.
7. **Provenance.** When the task reaches `done`, an `asset_provenance` row
   (`origin: 'generated'`, `mediaTaskId`, `runId`, prompt, params) is recorded;
   `GET /api/projects/:id/assets/provenance` reads it.
8. **Late outputs.** If the run already ended, the file is attached to that
   run's message afterwards (`associateLateRunProducedFile`).

Failures follow the existing media failure contract (`error.nextStep`); an image
that cannot be decoded for resizing fails the task rather than writing an
unshaped file.

## Known limits

- A hosted job resumed after a daemon restart delivers the provider's own size:
  the resize plan is not persisted with the cloud job link.
- Keying needs a flat backdrop. A busy background is keyed as far as it is flat
  and the task file carries a warning saying parts may remain opaque.
- No ML background removal. `pixo asset remove-bg --mode model` is still
  deferred.
