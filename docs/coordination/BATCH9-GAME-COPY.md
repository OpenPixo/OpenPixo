# Batch 9 — game-copy change record

Date: 2026-10-29. The retired Batch 8 working list is replaced by this record of implemented changes. No Playwright test ran in this batch.

## Dictionary accounting

Deleted 214 keys from Dict and each locale (2,357 → 2,143); seven retained keys were renamed separately. Twenty paired entries were rewritten: 17 requested entries and three additional corrections. All 42 protected mode/example properties in each locale are unchanged.

| Removed family | Keys |
| --- | ---: |
| `homeHero.chip.*` | 3 |
| `chat.selectFromLibrary` | 1 |
| `filesPanel.library.*` | 2 |
| `libraryPicker.*` | 6 |
| `newproj.*` | 40 |
| `designs.*` | 2 |
| `chat.designToolbox.*` | 106 |
| `nextStep.projectGenerateArtifact*` | 1 |
| `library.*` | 53 |

Renames: `handoff.promptKeepDesign` → `handoff.promptKeepProject`; six `chat.designToolbox.context.*` labels → neutral `chat.context.*` labels (`designFiles` → `projectFiles`). These context labels serve retained composer resources; no toolbox remains.

## Extra dictionary rewrites

| Key | New English | New 简体中文 |
| --- | --- | --- |
| `designs.cardFreeform` | Game project | 游戏项目 |
| `filesPanel.empty` | Project files will appear here | 项目文件会显示在这里 |
| `settings.customInstructionsDesc` | Fixed instructions OpenPixo follows in every chat. Use them for coding preferences and project conventions. | OpenPixo 在每次对话中遵循的固定指令。可用于说明代码偏好和项目约定。 |

## Extra inline game copy

These changes remove remaining commercial/design defaults from retained Home media starters and creation inputs. They do not change the protected `chat.example*` dictionaries. An em dash means the original data is English-only.

| Location | New English | New 简体中文 |
| --- | --- | --- |
| `HomeHero.HOME_PROMPT_EXAMPLES.image[0]` | Create full-body concept art for a wandering knight in a 2D action game, with a readable silhouette, worn leather armor and one bright accent color. | 为 2D 动作游戏生成流浪骑士全身概念图，轮廓清晰，穿旧皮甲，并使用一种鲜明的强调色。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.image[1]` | Create key art for a cozy farming game with a farmhouse at sunrise, crop fields, a warm palette and space for the game logo. | 为温馨农场游戏生成宣传图，包含日出中的农舍、农田、暖色调，并为游戏标识留出空间。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.image[2]` | Create a top-down forest tileset for a pixel-art adventure game, with readable paths, grass, rocks and seamless edges. | 为像素冒险游戏生成俯视森林地图图块，包含清晰的路径、草地和岩石，边缘可无缝拼接。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.image[3]` | Create a set of inventory icons for a fantasy RPG: health potion, iron sword, wooden shield and a glowing quest key. | 为奇幻 RPG 生成一组背包图标：生命药水、铁剑、木盾和发光的任务钥匙。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.video[0]` | Create an 8-second teaser for a pixel-art platformer, following the hero across crumbling platforms above lava and ending on the final jump. | 为像素平台游戏制作 8 秒预告，跟随主角穿过熔岩上方坍塌的平台，并以最后一次跳跃结束。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.video[1]` | Create a short gameplay walkthrough showing movement, an enemy encounter and the level-complete moment in a 2D action game. | 为 2D 动作游戏制作一段玩法演示，展示移动、遭遇敌人和通关时刻。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.video[2]` | Create a vertical character reveal for a fantasy RPG with a readable silhouette, weapon details and a final in-game pose. | 为奇幻 RPG 制作竖屏角色展示，突出清晰的轮廓、武器细节和最后的游戏内姿态。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.video[3]` | Create a 15-second trailer for a cozy farming game with planting, harvesting and a sunset view of the finished farm. | 为温馨农场游戏制作 15 秒预告，展示播种、收获和夕阳下建好的农场。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.hyperframes[0]` | Build a captioned game update short with title cards, gameplay clips, readable transitions and a final list of new features. | 制作带字幕的游戏更新短片，包含标题卡、玩法片段、清晰的转场和最后的新功能列表。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.hyperframes[1]` | Create an audio-reactive visualizer for a rhythm game where bars and particles follow the music beats. | 为节奏游戏制作音频响应视觉效果，让柱状图和粒子跟随音乐节拍变化。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.hyperframes[2]` | Create a 3-second level-complete animation using a star burst, a score count-up and a clear final state. | 制作 3 秒通关动画，包含星光迸发、分数递增和清晰的最终状态。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.hyperframes[3]` | Animate an adventure-game world map with level nodes, an unlocking route and a final destination reveal. | 为冒险游戏制作世界地图动画，展示关卡节点、逐步解锁的路线和最终目的地。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.audio[0]` | Create a short start-game sound for a fantasy adventure, with a bright chime, a gentle swell and a clean ending. | 为奇幻冒险游戏制作简短的开始游戏音效，包含明亮提示音、轻微渐强和干净的收尾。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.audio[1]` | Create a 20-second title-screen music loop for a cozy farming game, with a warm melody and a seamless return to the beginning. | 为温馨农场游戏制作 20 秒标题画面循环音乐，旋律温暖，结尾可无缝回到开头。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.audio[2]` | Create a seamless forest ambience loop for an exploration game, with soft wind, distant birds and gentle leaves. | 为探索游戏制作无缝森林环境音循环，包含柔和的风声、远处鸟鸣和轻微树叶声。 |
| `HomeHero.HOME_PROMPT_EXAMPLES.audio[3]` | Create distinct game UI sounds for selecting an item, completing a quest and an invalid action, with a consistent tone. | 制作风格统一的游戏 UI 音效，分别用于选中物品、完成任务和无效操作。 |
| `HomeHero.pluginPresetArtifactLabel.default` | game project artifact | 一个游戏项目产物 |
| `HomeHero.briefForChipId.image.style` | cinematic, readable, consistent with the game art style | — |
| `HomeHero.briefForChipId.video.style` | cinematic, readable, consistent with the game art style | — |
| `HomeHero.briefForChipId.audio.style` | clear, polished, consistent with the game audio style | — |
| `chips.image.description` | Sprites, concept art & key art | — |
| `chips.image.inputs.subject` | character concept art for a 2D action game | — |
| `chips.image/video.inputs.style` | cinematic, readable, consistent with the game art style | — |
| `chips.video.description` | Gameplay clips & trailers | — |
| `chips.video.inputs.subject` | a short gameplay teaser for a pixel-art platformer | — |
| `chips.audio.inputs.subject` | a short set of game UI sounds for selection, quest completion and errors | — |
| `EntryShell.defaultPluginInputsForCreate` style fallback | cinematic, high-quality, game-ready | — |

The five ChatPane starter entries and bilingual continue/plan prompts follow the owner-supplied text. Their original icons and other ChatPane starter entries are retained. File-format names, export-progress labels, `deck.gl`, persisted session mode IDs and installed-plugin facet/category labels are unchanged.

## Playwright host checklist

Not run here by explicit instruction. Run or realign only the retired setup/copy assertions below; preserve retained chat/file/provider behavior and installed-plugin fixtures.

| File | Removed or changed reference | Host action |
| --- | --- | --- |
| [e2e/ui/api-empty-response.test.ts](../../e2e/ui/api-empty-response.test.ts) | `new-project-tab-prototype` | Use a retained game/API project fixture before exercising empty-response handling. |
| [e2e/ui/critical-smoke.test.ts](../../e2e/ui/critical-smoke.test.ts) | `new-project-tab-prototype` | Replace the prototype-form creation witness with the kept NewGameDialog game-template creation witness. |
| [e2e/ui/reload-spurious-failed-run.test.ts](../../e2e/ui/reload-spurious-failed-run.test.ts) | `new-project-tab-prototype` | Create a retained game/API fixture, then preserve the reload/run-status assertions. |
| [e2e/ui/workspace-keyboard-flows.test.ts](../../e2e/ui/workspace-keyboard-flows.test.ts) | `new-project-tab-prototype` | Create a retained game/API fixture, then preserve keyboard and file-workspace assertions. |
| [e2e/ui/split-resize-scrollbar-hitbox.test.ts](../../e2e/ui/split-resize-scrollbar-hitbox.test.ts) | `new-project-tab-prototype` | Create a retained game/API fixture, then preserve split-resize hitbox assertions. |
| [e2e/ui/real-daemon-run.test.ts](../../e2e/ui/real-daemon-run.test.ts) | `new-project-tab-prototype` | Create a retained game/API fixture, then preserve mock-runtime chat, plan and file-preview checks. |
| [e2e/ui/app-restoration.test.ts](../../e2e/ui/app-restoration.test.ts) | `new-project-tab-prototype; new-project-tab-live-artifact; new-project-tab-${entry.create.tab}` | Retarget shared project setup to retained creation; remove only already-retired scenario cases, preserving restoration/history/files checks. |
| [e2e/ui/project-management-flows.test.ts](../../e2e/ui/project-management-flows.test.ts) | `new-project-tab-prototype; new-project-tab-live-artifact; new-project-tab-deck; new-project-tab-media` | Delete retired design-tab cases; enter the retained media surface directly and preserve project-management/media checks. |
| [e2e/ui/app.test.ts](../../e2e/ui/app.test.ts) | `new-project-tab-${entry.create.tab}` | Update scenario setup and resources: media surfaces remain directly selectable, while kept workspace cases need game/API setup. |
| [e2e/ui/app-design-files.test.ts](../../e2e/ui/app-design-files.test.ts) | `new-project-tab-${entry.create.tab}; new-project-name default creation` | Retarget project setup, preserving file upload/delete/download/markdown/preview behavior. |
| [e2e/ui/entry-configuration-flows.test.ts](../../e2e/ui/entry-configuration-flows.test.ts) | `new-project-tab-media` | Select new-project-media-surface-image directly; preserve prompt-template retry and edited metadata assertions. |
| [e2e/ui/settings-media-providers.test.ts](../../e2e/ui/settings-media-providers.test.ts) | `new-project-tab-media` | Select image/video/audio directly; preserve provider persistence and mock media generation checks. |
| [e2e/ui/visual-entry.test.ts](../../e2e/ui/visual-entry.test.ts) | `visual-new-project-modal` | Review the media-only modal screenshot; leave installed-plugin category and title fixtures unchanged. |
| [e2e/ui/recent-project-covers.test.ts](../../e2e/ui/recent-project-covers.test.ts) | `.recent-projects__deck-iframe` | Assert the neutral HTML cover iframe instead, preserving HTML file-preview behavior and legacy deck metadata. |
| [e2e/ui/recent-project-comment-cover.test.ts](../../e2e/ui/recent-project-comment-cover.test.ts) | `.recent-projects__deck-iframe` | Assert the neutral HTML cover iframe instead; do not restore deleted preview-comment bridges. |

- Shared setup [e2e/lib/playwright/rail.ts](../../e2e/lib/playwright/rail.ts): Shared openNewProjectModal still opens the retained modal, now media-only. Its old navigation comments are historical; the helper is not itself a Playwright file.
- Shared setup [e2e/resources/playwright.ts](../../e2e/resources/playwright.ts): Resource-driven setup still names prototype/deck/live-artifact tabs removed by this or earlier batches; update only retired setup/scenarios, not kept chat/file/metadata fixtures.

- No e2e/ui references to the removed library route, LibrarySection, design toolbox action IDs, NextStep More toolbox IDs, or project-generate-artifact ID were found.
- Plugin category labels and installed-plugin fixtures (Prototype, Slides, Document, Deck Writer, HyperFrames) are intentionally retained metadata, not candidates for renaming.
- Legacy metadata kind prototype/deck and HTML deck fixtures remain valid inputs; do not rename them merely because badges become generic Game.
- The app/app-restoration resource pools contain already-retired deck/comment/live-artifact cases. Their presence is an existing stale-suite condition, distinct from the newly removed prototype/media wrapper tab.
- Retained exact-copy rewrite keys produced no additional literal Playwright assertions; list covers creation and project-cover changes.

Validation outcomes and retained shared pieces are recorded in [SLIM-CORE.md](SLIM-CORE.md#batch-9--game-copy).
