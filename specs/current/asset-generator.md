# OpenPixo asset generator (生成素材)

Status: draft, 2026-11-14. Not started. Replaces the Studio sheet described in
`openpixo-game-panel.md` §6 ("生成素材… opens the recipe picker") and the
free-form `HostedImageCard`. Recipe format and executor stay as
`openpixo-phase4-studio.md` defines them; this spec widens who can run them and
how they are shown.

## 1. Why

生成素材 has to work two ways with one implementation:

- **On its own**, like any image generator: type what you want, get a few
  results, keep the one you like. Today the only free-form box is the hosted
  card, which makes one result, saves it straight into the project, keeps no
  history and is hidden for users with their own key.
- **As the menu the agent picks from.** The agent already runs recipes through
  `pixo recipe`, but sees a thin list and cannot use them for audio or 3D on
  credits.

Reference for display and tool set: a game-art generation site (reviewed 2026-11-14). What we
take from it: one prompt box everywhere; presets shown as before → after cards
that open with the box already filled; every style and preset shown as a
picture; per-result tools (variations, restyle, background removal, upscale,
new angle, extend); a detail panel that keeps everything that made an image and
can make it again. What we do not take: community feed, contests, style-model
marketplace, membership.

## 2. Decisions

Made with the owner, 2026-11-14:

1. The generator is the front of 生成素材. Recipes become **presets** inside it,
   not a separate list.
2. It covers **图片 · 音频 (音效 / 语音 / 音乐) · 3D** from the first release.
   Video comes later.
3. Results are **staged**. Nothing enters the project until the user presses
   保存到游戏 (or the agent adopts). Staged results stay in history.
4. History shows the **user's and the agent's** generations together.
5. A user's own click may spend credits on any recipe, image, audio or 3D,
   after a quote, the same way the hosted card does today.
6. Code recipes (Features, Starters) leave 生成素材.
7. The generator is **one top-level page, 生成**, beside 工坊 in the left rail
   (2026-11-14, replacing "its own panel view"). It makes art for a game picked at
   the top of the page, or for **no game**; a no-game result is saved into any game
   later. The game's panel has no 生成 view.
8. Results are downloaded to the user's machine and never saved or managed on
   our end (§5.1). History is what is on that machine.

Still open (§12): the prices of the new hosted services, and default counts.

## 3. Today

| Seam | Today | Change |
| --- | --- | --- |
| Recipe catalogue `apps/daemon/src/recipes/catalog.ts`, manifests `plugins/_official/recipes/*/pixo.json` | 30 recipes: 13 media, 17 code | Add built-in plain and action recipes (§4), `whenToUse`, `dimension`, `acts` |
| Recipe executor `apps/daemon/src/recipes/executor.ts` | Staged candidates under `RUNTIME_DATA_DIR/recipe-runs/<run>/<candidate>`; post-processing and checks; `adopt` writes to the project and records provenance | Keep. Add `origin`, a per-project run listing, user-paid runs on every surface |
| Hosted spend in recipes, `executor.ts:161` | Refused unless an agent grant with art budget, image only | §5 |
| Hosted spend in media, `routes/media.ts:387` | Two authorities: a quote the user confirmed, or an agent grant with art budget | Recipe runs follow the same two |
| Hosted card `components/studio/HostedImageCard.tsx` | Image, sfx, voice, music, 3D on credits; one result; saves to `images/…`, `audio/…`, `models/…` | Replaced by the generator |
| Studio sheet `components/studio/StudioPanel.tsx` in `panel/LibraryView.tsx` | Hosted card + recipe list + art styles + characters | Becomes the generator (§6) |
| Asset ops `packages/contracts/src/api/asset-ops.ts` | `resize trim slice pack export-spritesheet pixelate palette seamless-check remove-bg frames-* audio-normalize audio-trim audio-loop audio-convert`; `remove-bg` is chroma only (`model` mode deferred, `assets/ops/images.ts:90`) | Used as recipe post-processing and as result actions; hosted background removal fills the `model` gap |
| Hosted services (cloud `generation-services.ts`) | `openpixo-image` (text to image), `openpixo-image-edit` (1–4 references), `openpixo-sfx` (length), `openpixo-voice` (voice list), `openpixo-music` (instrumental), `openpixo-model3d-draft/-/-high` (image to 3D only) | §10 adds background removal and upscale |
| Agent prompt `renderGameRecipesBlock` (`packages/contracts/src/prompts/openpixo-game.ts:223`) | First 12 by surface then id, title only; `vfx-sequence` never fits; engine filter only | §8 |
| Chat `components/chat/AssetGallery.tsx` | Shows what a turn made | Links each item to its run in the generator |

## 4. One model: every generation is a recipe run

There is no separate code path for "free-form". The plain generator is the
simplest recipe, and every per-result tool is a small recipe that takes a
result as input. One run store, one staging step, one adopt, one history, one
CLI.

**Plain recipes**, one per kind (category `plain`). Two already existed and
serve as-is:

| Id | Surface | Inputs | Post-processing |
| --- | --- | --- | --- |
| `openpixo/image` (new) | image | `prompt`, `reference` · `reference2` · `reference3` (image-ref), `aspect`, `transparent` (boolean), `name`; 4 candidates on own tools | a cutout when `transparent` |
| `openpixo/sound-effect` (new) | audio | `prompt`, `duration`, `format`, `name`; 3 takes on own tools | `audio-trim`, `audio-normalize` (-16 LUFS), `audio-convert` |
| `openpixo/music` (new) | audio | `prompt`, `format`, `name` | `audio-loop`, `audio-convert` |
| `openpixo/npc-voice-lines` | audio | `line`, `voice`, `language`, … | as shipped |
| `openpixo/model-from-image` | model3d | `image`, `name`; the quality tier is the run's `model` | none |

The prompt template of a plain recipe is the user's text plus the project art
style, which `mergeImageArtStyle` already applies to image runs. A recipe input
named `transparent` set to true asks for a cutout, as `generation.background:
transparent` does for a recipe that always wants one. `name` is required; the
generator fills it from the prompt. The agent's recipe list puts plain recipes
after the presets, so the 12-entry list still shows the presets it showed before
(§8.1 replaces the cap).

**Action recipes** take one result and make something from it. A manifest
declares what it acts on:

```json
"recipe": {
  "surface": "image",
  "category": "action",
  "acts": { "on": ["image"], "label_i18n": { "zh-CN": "变体", "en": "Variations" } },
  "inputs": [{ "name": "source", "type": "asset-ref", "required": true }, …]
}
```

A result card lists the action recipes whose `acts.on` matches its kind (§7).
Running one from a staged candidate passes the candidate's staged file. Running
one from a saved asset passes the project path. Presets (sprite sheet, icon
set, tileset…) are ordinary recipes without `acts`.

**Manifest additions** (`RecipeSchema` in `packages/contracts/src/plugins/manifest.ts`):

- `whenToUse`: one English line for the agent ("a set of matching inventory
  icons on one sheet"). Optional `whenToUse_i18n` for the preset drawer.
- `dimension`: `["2d"]`, `["3d"]` or both. Replaces guessing from `engines:
  ["any"]`, so a 2D Phaser game stops being offered `skybox`.
- `acts` as above.
- `examples`: up to four `{ before?, after, caption_i18n }` image paths inside
  the recipe folder, for the before → after card and drawer (§6.4). Audio and
  3D examples are a short clip or a `.glb` with a poster.

**Run record additions** (`RecipeRun` in `packages/contracts/src/api/recipes.ts`):

- `surface` and `origin: 'user' | 'agent'` (landed with slice 1). The daemon sets
  `origin` from the request's grant, never from the body. Both are absent on runs
  recorded before.
- `source?: { runId, candidateId } | { path }` for action runs, so history can
  show what came from what (slice 4).
- Saved paths per candidate are the existing `adoptedPaths`.

## 5. Paying

The recipe executor uses the same two authorities as `routes/media.ts`:

- **No agent grant: the user confirmed a quote.** The UI prices every candidate
  of the run with `POST /api/projects/:id/recipe-runs/quote` (below). The button
  shows the estimated total. A total above the button's number stops and asks,
  and a balance below it offers credits, as the hosted card does now. The run
  request carries the returned `quoteId`; the daemon holds one cloud quote and
  request id per candidate behind it. A retry reuses them, so it cannot pay
  twice. This works for image, audio and 3D.
- **Agent grant: the art budget.** Unchanged rules from AGENTS.md "Art budget":
  the daemon prices and reserves each candidate in `ArtBudgetLedger.reserve`,
  `ask` mode needs an approved art card, and one candidate is made unless
  `--count` is passed. What changes is that audio and 3D recipes may now spend the
  budget too, so update that AGENTS.md section when this lands.

`executor.ts:161` changes from "agent and image only" to "one of the two
authorities, any media surface". The CLI follows `pixo media`'s confirmation
(`media/openpixo-hosted-cli.ts`): `pixo recipe quote <id> …` prices every
candidate and prints the total, and `pixo recipe run <id> … --quote <quoteId>`
spends exactly that. Without a grant and without `--quote`, a hosted run is
refused with `GENERATION_CONFIRMATION_REQUIRED`.

Known gap, not widened: a user-confirmed quote can be obtained from an agent's
shell without its token (pinned in `apps/daemon/tests/game/art-budget.test.ts`).
Recipe runs inherit exactly that gap and no more. The test is extended to cover
recipe runs so a change to it is visible.

Hosted naming stays neutral: built-in recipes, presets, actions and errors name
no upstream provider. A provider appears only in Settings where a user enters
their own key.

How the user's price works (slice 1): `POST /api/projects/:id/recipe-runs/quote`
plans the run with the same code the run uses (`RecipeExecutor.plan`), shapes
each candidate with `planHostedRequest` (the shaping the art budget also uses),
asks the cloud for one quote per candidate and holds them in the daemon under one
`quoteId`. The run passes `quoteId` with the same request; a different request is
refused (`RECIPE_QUOTE_MISMATCH`), an expired or unknown one too
(`RECIPE_QUOTE_UNKNOWN`), and an agent's token can neither ask for a price nor
spend one. Asking again with a spent price returns its run. A run that would pay
and has neither a token nor a price is refused with
`GENERATION_CONFIRMATION_REQUIRED`. When an own tool makes the run, the quote
answers `paid: false`.

### 5.1 Where results live

Nothing is kept on our end. A hosted result is downloaded straight from the
provider's link to the user's machine (`media/openpixo-hosted.ts`, checked by
size, hash and the file's own signature); the cloud only hands out the link and
keeps no copy and no history. Staged candidates live in the daemon data root on
that machine (`RUNTIME_DATA_DIR/recipe-runs`) and are removed after 7 days
(`RECIPE_RETENTION_MS`). Saved results are ordinary project files. 生成's history
lists only what is on the machine, and 下载 in the detail panel saves a copy
anywhere the user picks.

## 6. The generator

### 6.1 Where it lives

**Current (2026-11-14, later the same day): one page.** `/generate` (no game) and
`/generate/<projectId>` (that game picked) render `components/generate/GeneratePage.tsx`
in the entry shell, beside 工坊 (`EntryNavRail` 生成). The game picker at the top
decides where references come from (the game's files, or pictures uploaded with
`POST /api/generate/references` into `RUNTIME_DATA_DIR/generate/references`, kept
30 days) and which runs the history lists (that game's, or every run with its
game named). 文件's 生成素材…, "以此生成" and the old `/projects/:id/generate` open
the page with the game picked, handing pictures over in session storage
(`studio/entry.ts`). The runs, quotes and adoption behind it are `/api/generate/*`
(`recipes/generate-routes.ts`), the same runs `/api/projects/:id/recipe-runs`
serves; a run with no game has `projectId: null`, keeps no media task, and is
saved at the paths the target game's engine gives the recipe's output. An agent's
token reaches only its own game. The text below this paragraph is the earlier
panel design and stands where it does not conflict.

Its own panel view, **生成**, beside 游戏 · 改动 · 文件 (decided 2026-11-14). A
grid plus history does not fit a sheet over 文件. 文件's 生成素材… button, the
composer entry points, "generate from" on an asset and `tabRequest: 'generate'`
all switch to it. Like the other views it keeps its own in-place stack (the
detail panel and preset drawer push onto it; Esc or ← pops) and the view choice
persists with the existing per-project key. 文件 stays a plain browser; its
asset actions keep "generate from", which opens 生成 with the asset as a
reference.

### 6.2 Layout

```
┌ 生成 ────────────────────────────────────────────────┐
│ [图片] [音频] [3D]                                    │
│ ┌──────────────────────────────────────────────────┐ │
│ │ 描述你想要的素材…                                  │ │
│ │ (+参考图)                                          │ │
│ │ 4 张 · 1:1 · 画风: 16 位像素 ✓ · 透明背景      ⚡16 生成 │
│ └──────────────────────────────────────────────────┘ │
│ 预设: [自由] [精灵图] [图标组] [地块] [UI 九宫格] … 更多 │
├──────────────────────────────────────────────────────┤
│ 本次结果  ▢ ▢ ▢ ▢                                     │
│ 历史  [全部][图片][音频][3D] [我][AI]                  │
│ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ …                                    │
└──────────────────────────────────────────────────────┘
```

- Kind tabs choose the plain recipe. 音频 shows a second row: 音效 · 语音 · 音乐.
- The box holds the plain recipe's inputs: prompt, references (from project
  images, paste or drop), count 1–4, aspect, transparent background for images,
  length for sound effects, voice for lines, loop for music, quality for 3D.
- The project art style is on by default for images and shown as a chip;
  clicking it opens the style picker (§6.4).
- The button shows the estimate (§5). With an own key it shows no credits.
- Choosing a preset swaps the box's fields for that recipe's inputs and shows
  its examples in a strip above them. 自由 returns to the plain recipe. The
  results grid and history stay the same.
- 3D starts from an image. With no image picked, the box says so and offers
  "先生成一张图" (image tab with the prompt kept) or 从项目里选. The two steps stay
  visible; no hidden chain spends credits twice.

### 6.3 Results, history, detail

- **This run** shows its candidates as they finish (progress per candidate).
- **History** lists this project's runs newest first, both origins, with kind
  and origin filters. An agent run carries an AI badge.
- Clicking a result opens the **detail panel**:
  - a large preview
  - the prompt (copyable) and preset name
  - the inputs, model label (neutral for hosted), art style and references used
  - credits spent, and where it was saved, if saved
  - the run it came from, for action results
  - buttons: 保存到游戏 · 下载 (save a copy anywhere) · 再来一次 (same inputs, new
    run) · 改一下 (loads the inputs into the box) · actions (§7) · 让 AI 接入 (§8.3)
- **保存到游戏** calls `recipe adopt` for that candidate: the engine path from the
  recipe's `output`, provenance recorded, files panel refreshed. Several
  candidates may be saved.

### 6.4 Showing things as pictures

- **Preset cards** show before → after from `examples` (image), a waveform with
  play (audio) or a poster with turn-on-hover (3D). Clicking opens the **preset
  drawer**: title, one-line promise, example carousel with captions, then the
  box filled for that preset ("不用写描述，选一张角色图就行" where that is true).
- **Style picker** is a grid of each art style's sample image with its name,
  tabs 推荐 · 本项目 · 最近. The project style is marked.
- **Empty states**: an action or preset with no results yet shows its example
  before → after instead of a blank area.

### 6.5 Result cards by kind

| Kind | Card | Detail preview |
| --- | --- | --- |
| Image | Thumbnail on a checkerboard when transparent, size badge | Zoom, pixel-exact toggle for small sprites |
| Sound effect / voice | Waveform, play, length; takes of one run grouped | Player, loop off |
| Music | Waveform, play, length, loop marker | Player with 循环试听 so the seam can be heard |
| 3D | Poster image, turns on hover; triangle count, textured yes/no, quality | Orbit viewer (the existing model preview), ground grid |

## 7. Actions on a result

Each action is an action recipe (§4), so the UI, the agent and the CLI reach it
the same way. "Hosted" names what it runs on with credits; with an own key it
uses any configured model with the capability.

**Image**

| Action | Runs on | Notes |
| --- | --- | --- |
| 变体 Variations | `openpixo-image-edit` | Source as reference, same prompt |
| 换成项目画风 Restyle | `openpixo-image-edit` | Prompt from the project art style; strength select 保留形状 / 平衡 / 大胆 |
| 草图变成稿 From sketch | `openpixo-image-edit` | Takes a rough drawing or colour blocks |
| 换个角度 New angle | `openpixo-image-edit` | Preset angles 正面 · 侧面 · 背面 · 45°; feeds `character-turnaround` |
| 扩图 Extend | `openpixo-image-edit` | Direction + new aspect |
| 去背景 Remove background | local `remove-bg` chroma; hosted background removal (§10) | Hosted fills the deferred `model` mode |
| 放大 Upscale | local `resize` nearest for pixel art; hosted upscale (§10) for the rest | Pixel-art styles never get AI upscale |
| 转 3D | `openpixo/model3d` | Next step across kinds |

**Audio**

| Action | Runs on |
| --- | --- |
| 变体 | same service, same prompt |
| 裁剪 Trim | local `audio-trim` |
| 做成循环 Loop | local `audio-loop` |
| 统一音量 Normalize | local `audio-normalize` |
| 换个声音 Other voice | `openpixo-voice`, same line |
| 翻译台词 Translate line | `openpixo-voice`; the line is translated by the hosted agent model before speaking |
| 导出格式 Convert | local `audio-convert` (ogg / wav / mp3) |

**3D**

| Action | Runs on |
| --- | --- |
| 换质量重做 Redo at quality | `openpixo/model3d` with the source image |
| 用三视图做 From three views | `character-turnaround` → `openpixo/model3d` |
| 减面 · 绑骨骼 · 重新贴图 | Later; §10 |

**Next steps across kinds** (shown first on a card when they apply): character
image → 三视图 → 3D; character → voice line; scene image → ambience loop
(`openpixo/sfx` with a prompt drafted from the image caption).

Local actions cost nothing and need no quote.

## 8. The agent side

### 8.1 Prompt

`renderGameRecipesBlock` lists media recipes as
`` `id` (surface/category): title, when to use `` filtered by engine **and**
`dimension`, plain and action recipes included, code recipes left out. The cap
becomes a size budget rather than 12 entries; if the list still overflows, the
last line points to `pixo recipe list --json`. The block tells the agent:

- prefer a preset, then a plain recipe, over a raw `pixo media generate`, so the
  result lands in history with provenance;
- action recipes take `--input source=<path>`;
- audio and 3D recipes now spend the art budget too.

Per-turn markers stay outside the cached prefix (`docs/prompt-composition.md`).

### 8.2 CLI

No new command family. Existing `pixo recipe list | show | run | status | adopt
| cancel` gains `runs` and `quote`:

- `pixo recipe runs [--kind image|audio|model3d] [--origin user|agent] --json`:
  this project's history, the same payload as the UI's.
- `pixo recipe quote <id> …` and `pixo recipe run <id> … --quote <quoteId>`: a
  user-paid run from a terminal (§5).
- `pixo recipe list --acts image` filters action recipes by what they act on.

### 8.3 Handoff between the two

- **让 AI 接入**, on a saved result, puts a draft in the composer: what was made,
  where it was saved, which recipe made it, and a short "please use it as …".
  The user edits and sends. Nothing is sent automatically.
- The chat's `AssetGallery` item for an agent-made recipe result opens that run
  in the generator, so the user can pick another candidate or run it again.
- Nothing about the generator changes Plan mode or the planning gate.

## 9. Code recipes move out

Features (`feature-*`) and Starters (`starter-*`) leave the generator. Features
are offered from the composer's add menu as 添加功能; starters stay with new-game
setup. Until those homes exist, they remain reachable through `pixo recipe` and
the agent prompt, not through 生成.

## 10. Provider coverage

| Need | Credits (hosted) | Own key |
| --- | --- | --- |
| Image, edit actions | existing `openpixo-image`, `openpixo-image-edit` | any configured image / i2i model |
| Transparent image | ask the model for alpha; otherwise key colour + soft edge (already in `generation.background`) | same |
| Background removal | **new** hosted service (cloud repo) | provider model when configured; local chroma otherwise |
| Upscale | **new** hosted service (cloud repo) | provider model when configured |
| Sound effects, voice, music | existing services | configured audio models |
| 3D from image | existing three tiers | configured 3D model |
| Rig, retexture, fewer triangles, text to 3D | later; check what our 3D providers expose before promising | — |
| Video, video to frames | later | — |

New hosted services are added in `openpixo-cloud` `generation-services.ts` with
neutral ids (`openpixo-remove-bg`, `openpixo-upscale`), listed only to app
versions that know them, priced by the owner (O3).

## 11. Delivery slices

Each capability lands its endpoint, UI and CLI together (AGENTS.md "Capability
exposure"). Slice 1 has no UI of its own, so **slices 1 and 2 ship as one
change**; 3 can follow in parallel with 2; 4–6 after 2.

1. **Runs and paying.** Built 2026-11-14, not yet committed. Contracts:
   `RecipeRun.surface` / `origin`, `RecipeRunRequest.quoteId`,
   `RecipeQuoteRequestSchema`, `RecipeRunQuote`, `RecipeRunListResponse`;
   manifest `whenToUse` / `dimension` / `acts` (examples reuse the manifest's
   existing `examples`). `RecipeExecutor.plan` split from `start`; both spend
   authorities on image, audio and 3D; `planHostedRequest` split from
   `prepareAgentHostedRequest`. Routes `GET …/recipe-runs`, `POST
   …/recipe-runs/quote`, `quoteId` on runs. CLI `pixo recipe runs`, `quote`,
   `run --quote`. Plain recipes `image`, `sound-effect`, `music`. Tests in
   `apps/daemon/tests/game/art-budget-recipes.test.ts` and
   `recipes-cli-style.test.ts`. AGENTS.md "Art budget" updated.
2. **Generator view.** Built 2026-11-14, not yet committed; ships together
   with slice 1. `components/generate/*`: `GenerateView` (fourth panel view),
   `GenerateBox` (kind tabs, description, references, options, estimate, quote
   then run; a higher price stops and asks, a short balance offers credits),
   `GenerateHistory` (this machine's runs, kind and origin filters, tiles),
   `ResultDetail` (保存到游戏, 下载, 再来一次, 改一下), pure
   `generate-request.ts`. 文件 keeps 生成素材… and "generate from", which switch
   to 生成. `HostedImageCard` and its tests are gone; their billing rules are
   now tested in `tests/components/generate-view.test.tsx`. Until slice 3, the
   recipe list, art styles and characters sit in a folded 预设、画风与角色
   section, mounted the first time it opens. The detail view is the view's own
   state rather than an item on the panel stack (← or Esc returns). Default
   counts: image 2, sound effect 3, voice 1, music 1, 3D 1; the box lets the user
   pick 1 to the recipe's maximum. Originally planned as: the 生成 panel view
   (switcher entry, stack, entry points redirected), kind tabs, box, estimate and
   confirm, this-run grid, history, detail panel, 保存到游戏. Works with credits
   and own key. Removes `HostedImageCard`. Owns `components/studio/*` (new
   `components/generator/*`), the panel view wiring, i18n keys.
3. **Presets shown as pictures.** Built 2026-11-14 with the page: preset cards
   (`PresetCards`, media recipes other than the box's plain ones; any-engine ones
   with no game), a drawer with the examples and the recipe's form
   (`PresetDrawer`, `RecipeRunner`), the style chip's picture grid in the box
   (`StyleChoices`). Manifest examples gain `inputs`, `before`, `after`, `cover`,
   served by `GET /api/recipes/:id/examples/:index/:which`. Originally: Preset row and drawer, `examples` for the 13
   media recipes, style picker grid, code recipes removed from the view. Owns
   recipe folders' `examples/`, `ProjectRecipeCatalog`, `StylePicker`.
4. **Actions.** Action recipes for §7 image and audio rows on existing services
   and local ops; result cards list them; next-step actions. Owns
   `plugins/_official/recipes/act-*`, result card components.
5. **Agent and chat.** Prompt block (§8.1), `AssetGallery` link, 让 AI 接入
   draft. Owns `renderGameRecipesBlock`, `catalog.ts:gameRecipePromptEntries`,
   `AssetGallery.tsx`.
6. **Cloud services.** Hosted background removal and upscale, then the actions
   that use them. Cloud repo first, app after.

## 12. Open decisions

- **O1 Where it lives.** Decided 2026-11-14: own 生成 view; the same day changed to
  one top-level page beside 工坊 that also works with no game (§6.1).
- **O2 How long staged results stay.** Decided 2026-11-14: results are
  downloaded and not saved or managed on our end (§5.1); unsaved candidates stay
  on the user's machine for the existing 7 days.
- **O3 Prices** of hosted background removal and upscale.
- **O4 Default count.** Settled for now with slice 2: image 2, sound effect 3,
  voice 1, music 1, 3D 1, changeable in the box. The estimate shows the cost.

## 13. Acceptance

- Credits only, no own key: type a prompt on 图片, get 4 results with a shown
  estimate, save one; it appears in 文件 with provenance. The same for a sound
  effect set, a voice line, a music loop and a 3D model from a saved image.
- Own key only: the same flows run with no credit display.
- A preset (icon set) runs from the drawer with its fields prefilled and lands
  sliced files at its engine path.
- An agent turn that runs `pixo recipe run openpixo/sfx …` shows in history with
  the AI badge; another candidate can be saved from the generator.
- An agent with art budget in `ask` mode cannot spend on an audio or 3D recipe
  without an approved art card; with `auto` mode it can, within the budget.
- An agent request with a body `quoteId` and no confirmed quote is refused, as
  in `routes/media.ts`.
- `pixo recipe runs --json` returns the same payload as the UI.
- No upstream provider name in the generator, its errors, history or detail
  panel on the hosted path (existing catalogue regression tests extended).
- `pnpm guard`, `pnpm typecheck`, focused daemon tests for `recipes/*` and
  media routes, focused web tests for the generator components, both locales
  complete.

## 14. Not in this spec

Video generation and video to sprite frames, inpainting with a mask brush,
style training on the user's own art, an infinite canvas, a community feed or
sharing of generations, rigging and retexturing 3D.
