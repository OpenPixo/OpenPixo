# Catalogue review — completed 2026-10-28

Decision: delete the inherited catalogue by family. Retain concrete game resources
and current dependencies of recipes, Studio, the bundled Store snapshot, the game
prompt and asset tools. A speculative future game use does not qualify.

The old 507-entry review is closed: 164 entries had already disappeared in earlier
removal batches; this batch deletes 283 more and retains 60. The wider current-tree
audit also covers game recipes and one-shot prompt JSON omitted from that old list.
No deferred or hidden inherited-family catalogue remains.

## Initial review counts (2026-10-28)

Counts are top-level skill/template directories, plugin entry directories, and
individual prompt-template JSON files; mirrored plugins and prompts count separately.

| Kind | Before | Retained | Deleted |
| --- | ---: | ---: | ---: |
| Functional skills | 153 | 30 | 123 |
| Design/media templates | 54 | 5 | 49 |
| Official/community plugins | 252 | 71 | 181 |
| Prompt-template JSON | 106 | 19 | 87 |
| Total | 565 | 125 | 440 |

Plugin directories include three old SKILL-only entries without manifests. The
manifest count changes from 249 to 71. Baked-preview entries change from 79 to 17;
62 orphaned/deleted-plugin records, one retired prompt preview PNG and 11 obsolete
or duplicate assets inside retained media trees are removed.
The initial Store seed contained 18 entries; the community seed remains empty.

## Applied family rules

- Keep the three Store engine/asset skills and all 26 game recipes. Studio's 12
  recipe IDs and the Store's eight recipe IDs are subsets of those 26. The four
  game templates and three external MCP presets in the Store are unchanged.
- Keep actionable game and browser workflows. An upstream link without a method
  is not a shippable skill. Delete general designer/UI style stacks, discovery/brief workflows,
  Figma/brand tools, documents, dashboards, business/social/marketing material and
  website/app presets. Delete the curated seed scripts and their commands so these
  families cannot be regenerated accidentally.
- Keep four reusable media authoring templates. Delete the WebGL hero template, fixed marketing compositions,
  educational history slide called sprite-animation, galleries and generic web
  simulations; their names alone do not establish a game dependency.
- Keep game icon/material/character/environment prompts and reusable shader/VFX
  tools. Delete fashion/avatar/editorial/product advertising, charts/infographics,
  dashboard prompts, social content and unrelated cinematic one-shots. Apply the
  same rule to each prompt JSON and its plugin wrapper.
- Keep seven generic coding atoms and the media-generation/plugin-authoring
  scenarios as extension tooling. Remove retired designer atoms, scenario defaults,
  stages and context references. All eight community examples are removed.
- Registry enumeration is not an explicit dependency that keeps every catalogue
  entry. Recipes embed their prompt strings; none loads a file under prompt-templates.
  No additional fixed design-template dependency was found in core consumers.

## Current functional-skill audit (2026-10-31)

The on-demand skills audit removes 26 catalogue shells with no actionable method
or companion files. None is a recipe, plugin or Store seed dependency. Together
with the 15 game workflow additions since the initial review, 19 functional skills
remain. Historical counts above describe the first removal batch. Registry seeds
and the Store snapshot already reference actionable game skills only.

`publish-game` (2026-11-04) joins the catalogue as the workflow for `pixo publish`; `specs/current/publish-and-rooms.md` owns the capability.

## Media-template and example audit (2026-10-31)

This follow-up traces the candidate folders through the daemon skill/template
registries and bundled-plugin walker, Media creation, shared scenario defaults,
Store seed, recipes/Studio, media scenario, packaging trees, tests and guides.
The initial counts above remain historical evidence.

`App.tsx` passes the enabled union of skills and design templates through the
entry shell and media modal to `NewProjectPanel`; this is an active creation
path, separate from generic catalogue enumeration.

| Retained resource | Current consumer and reason |
| --- | --- |
| `design-templates/image-poster` | Media creation selects the image workflow by mode in `NewProjectPanel.tsx` and supplies the model, aspect and style metadata for image-asset generation. |
| `design-templates/audio-jingle` | The Media audio surface selects this workflow by mode and supplies music, speech or SFX metadata. It provides the authoring method for game audio assets. |
| `design-templates/video-shortform` | The Media video surface selects this workflow for provider-generated clips; it supplies the shot and dispatcher instructions. |
| `design-templates/hyperframes` and `examples/hyperframes` | `NewProjectPanel.tsx` selects the template for `hyperframes-html`; `defaultScenarioPluginIdForProjectMetadata` binds `example-hyperframes` for the explicit HyperFrames intent. The daemon scaffold/renderer and packaged HyperFrames runtime remain required for this local video path. |
| `examples/pixo-plugin-publish-github` | The shared `publish-github` action and daemon publish endpoint use this utility; headless sharing and web plugin-action tests still exercise it. |

The media scenario calls the native `media-image`, `media-video` and
`media-audio` atoms, not the similarly named example wrappers. Recipes embed
their own prompts and call native media generation; Studio selects recipes.
None imports these candidate example/template folders. The media workflows are
retained for their current Media consumers, not as hypothetical recipe dependencies.

Deleted `design-templates/webgl-experience`: a generic full-screen shader hero,
with no game resource consumer. Deleted 17 example plugins:
`audio-jingle`, `image-poster`, `video-shortform`, `frame-glitch-title`,
`frame-light-leak-cinema`, `vfx-text-cursor`, `webgl-aurora-veil`,
`webgl-caustic-pool`, `webgl-experience`, `webgl-halftone-drift`,
`webgl-holographic-foil`, `webgl-liquid-iridescence`, `webgl-liquid-metal`,
`webgl-neon-grid`, `webgl-particle-galaxy`, `webgl-raymarched-hero` and
`webgl-voronoi-cells`. These are duplicate media entry points or fixed
website/title showcases; registry enumeration and gallery scores are not
dependencies. Their 17 baked-preview records and six popularity scores are
removed together.

The official Store seed contains no deleted candidate ID or path, so this
audit makes no seed delta. Packaging copies the resource roots generically;
there is no per-candidate pack list to prune. Stored WebGL intent metadata
remains readable, but no longer binds a bundled plugin automatically. Generic
plugin-use fixtures now use an independent game-prototype fixture.

The mirrored `frame-glitch-title` and `frame-light-leak-cinema` folders under
`plugins/_official/video-templates/`, and references to external HyperFrames blocks in prompt templates, are separately
owned and unchanged by the example-removal audit. Their manifests and local source
entries are revalidated during catalog integration below. Historical identifier/
packaging hit reports remain evidence of the builds they inspected, not current catalogue consumers.

Focused validation for this audit:

- `pnpm guard` passes, including the preview manifest/HTML contracts. A direct
  daemon-loader/registry check confirms four templates, two example plugins,
  a parseable 48-entry Store seed and zero orphaned baked previews.
- The scenario-default regression was red before removing the WebGL binding
  and green afterwards (5 tests). Focused web tests pass (41); daemon tests
  pass 62/63 and preview/manifest e2e checks pass 14/15.
- At the end of the example-removal audit, two checks still failed: the
  48-entry Store seed declared `bundledPreinstallCount: 33`, and 50 recipe/style
  manifests lacked `publishedAt`. Catalog integration below resolves both.
- Contracts, plugin-runtime and web typechecks pass. Daemon source/test
  `tsc --noEmit` phases pass with current contracts declarations. The normal
  contracts esbuild bundle step hits an access-denied ancestor-directory read
  in this environment; focused tests use the native config loader and ignored
  temporary configs pointing at current contracts source. No tracked build or
  test configuration is changed. Full suites are not run.

## Retained inventory

Skills (19): `agent-browser`, `enemy-ai-state-machines`, `game-assets-batch`, `game-design-doc`, `game-feel-juice`, `game-localization`, `game-ui-hud`, `godot-gdscript`, `level-design-tilemap`, `performance-profiling`, `phaser-game-dev`, `pixel-art-consistency`, `player-controller-2d`, `playtest-bug-triage`, `procedural-generation`, `save-load-and-settings`, `sfx-and-music-integration`, `sprite-animation-pipeline`, `web-export-and-itch`.

Media templates (4): `audio-jingle`, `hyperframes`, `image-poster`, `video-shortform`.

Generic atoms (7): `build-test`, `code-import`, `diff-review`, `handoff`, `patch-edit`, `rewrite-plan`, `todo-write`. Scenarios (2): `pixo-media-generation`, `pixo-plugin-authoring`.

Examples/utilities (2): `hyperframes`, `pixo-plugin-publish-github`.

Image plugin wrappers (12): `cozy-farming-sim-scene`, `deckbuilder-card-face-and-frame`, `dialogue-portrait-expression-sheet`, `item-ability-icon-sheet`, `metroidvania-biome-environment-concept`, `pixel-sprite-3d-diorama`, `retro-low-poly-horror-scene`, `roguelite-reward-choice-ui-mock`, `steam-capsule-key-art`, `store-screenshot-gameplay-moment`, `survivors-like-horde-gameplay-mock`, `toon-shaded-character-turnaround`.

Video plugin wrappers (9): `boss-reveal-cinematic`, `character-roster-reveal`, `devlog-intro-bumper`, `frame-glitch-title`, `frame-light-leak-cinema`, `gameplay-trailer-30s-beat-sheet`, `logo-sting-title-reveal`, `steam-next-fest-demo-teaser`, `vertical-juicy-gameplay-clip`.

Prompt JSON — image (12): `cozy-farming-sim-scene`, `deckbuilder-card-face-and-frame`, `dialogue-portrait-expression-sheet`, `item-ability-icon-sheet`, `metroidvania-biome-environment-concept`, `pixel-sprite-3d-diorama`, `retro-low-poly-horror-scene`, `roguelite-reward-choice-ui-mock`, `steam-capsule-key-art`, `store-screenshot-gameplay-moment`, `survivors-like-horde-gameplay-mock`, `toon-shaded-character-turnaround`.

Prompt JSON — video (7): `boss-reveal-cinematic`, `character-roster-reveal`, `devlog-intro-bumper`, `gameplay-trailer-30s-beat-sheet`, `logo-sting-title-reveal`, `steam-next-fest-demo-teaser`, `vertical-juicy-gameplay-clip`.

Art styles (20): `cel-anime`, `chibi-cute`, `cozy-pastel`, `crt-card-table`, `dark-gothic`, `flat-vector`, `horde-topdown`, `ink-woodcut`, `isometric-pixel`, `low-poly-3d`, `painted-cutout`, `painted-fantasy`, `pixel-16-bit`, `pixel-8-bit`, `retro-low-poly`, `sprite-diorama`, `toon-3d`, `vaporwave-crt`, `voxel-3d`, `watercolor-storybook`.

Recipes (30): `bgm-loop`, `character-turnaround`, `feature-achievements`, `feature-dialogue`, `feature-gamepad`, `feature-inventory`, `feature-localization`, `feature-save-system`, `feature-settings-menu`, `item-icon-set`, `model-from-image`, `npc-voice-lines`, `parallax-layers`, `pbr-texture`, `skybox`, `sprite-walk-8dir`, `starter-card-battler`, `starter-cozy-farm`, `starter-deckbuilder-roguelite`, `starter-idle-incremental`, `starter-match3`, `starter-platformer`, `starter-roguelike-dungeon`, `starter-survivors`, `starter-topdown-shooter`, `starter-tower-defense`, `tileset-seamless`, `ui-nine-slice`, `ui-sfx-pack`, `vfx-sequence`.

Genre starters (10) support both Godot 2D and Phaser. Six existing starters were revised and four
were added: `starter-survivors`, `starter-deckbuilder-roguelite`, `starter-cozy-farm`, `starter-idle-incremental`.
Their only skill context dependencies are godot-gdscript and phaser-game-dev;
both are retained. The Store additionally retains game-assets-batch.

The retro pixel family now has a default 16-bit tier and a strict 8-bit tier
covering two-tone 1-bit art. The standalone monochrome-1-bit entry is removed;
saved selections, generation requests and preview URLs resolve to pixel-8-bit.
Six additions cover sprite dioramas, painted cutouts, readable hordes, CRT card
tables, retro low-poly scenes and toon-shaded 3D.

The old 19 prompt JSON files and their provider-template wrappers were replaced
by 12 image and seven video prompts for game assets, store artwork and game
trailers. The two local HyperFrames wrappers (frame-glitch-title and
frame-light-leak-cinema) remain independently packaged. The vfx-text-cursor
video-template wrapper and its stale localized prompt copy are removed.
Chinese display copy covers every current prompt, including Concept Art and
Game Assets, and the starter input labels/options. Obsolete copy, tags and
popularity keys are removed; curated shelves now lead with Steam capsule art
and the gameplay-trailer beat sheet.

The official marketplace seed now has 62 entries, including all ten starter
upserts and the six style additions; bundledPreinstallCount equals its length.
All 50 recipe/style manifests missing publishedAt were backfilled. Read-only
git show HEAD:<path> checks found 40 pre-existing omissions and ten new files.
Existing entries use their addition-commit author time; new entries use the
current UTC authoring time. The earlier audit failures above are resolved.

Legacy webgl-experience metadata remains an explicit compatibility input:
scenario-defaults returns no automatic plugin for it, and the projects filter
still classifies saved WebGL projects. No current creation path emits it, but
removing those reads would change existing-project behavior, so they are retained.

The game composer and native asset CLI contracts remain independent of the
retired designer catalogue.

## Closure and validation

The inherited-family web filter is deleted; installed/imported extensions use the
normal registry behavior. Bundled copy, priority/popularity maps, preview metadata,
seed commands and exclusive tests are pruned with their resource entries. Generic
import, Store, question-form, media, external-directory and playback tests remain;
playback uses a neutral vendored GSAP fixture instead of a deleted showcase.

Validation results and new failure decisions are recorded in
[SLIM-CORE.md](SLIM-CORE.md#batch-4--catalogue). No provider calls, data-path changes,
database deletion or installed Alpha.3 lifecycle operations were made.
