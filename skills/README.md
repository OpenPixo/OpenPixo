

This directory contains **functional skills**: capabilities the agent invokes to do work on user input, such as briefs, audits, utilities, and asset packagers. Each folder has a `SKILL.md` and may include `assets/` or `references/`.

Rendering shapes for prototypes, decks, documents, images, video, and audio belong in [`design-templates/`](../design-templates/), not here. The classification rule and migration history live in [`specs/current/skills-and-design-templates.md`](../specs/current/skills-and-design-templates.md).

## Skill index

Choose workflows for the project's engine, target platform and chosen art style.

| Skill | Focus |
| --- | --- |
| [accessibility-for-games](accessibility-for-games/SKILL.md) | Remapping, subtitles, color cues, motion settings, assists and UI scale |
| [agent-browser](agent-browser/SKILL.md) | External browser CLI integration and browser validation |
| [character-controller-3d](character-controller-3d/SKILL.md) | First/third-person movement, jump grace, slopes, camera collision and lock-on |
| [enemy-ai-state-machines](enemy-ai-state-machines/SKILL.md) | Enemy behavior states and transitions |
| [game-art-set](game-art-set/SKILL.md) | New art that matches the style reference: one style sheet, a prompt template per asset family, review before wiring in |
| [game-assets-batch](game-assets-batch/SKILL.md) | Batch game-asset generation and processing |
| [game-balance-data](game-balance-data/SKILL.md) | Spreadsheet/CSV/JSON pipelines, curves and seeded simulations |
| [game-design-doc](game-design-doc/SKILL.md) | Project-owned game design documentation |
| [game-feel-juice](game-feel-juice/SKILL.md) | Adjustable impact feedback, hit-stop, particles and camera motion |
| [game-localization](game-localization/SKILL.md) | Game text extraction, localization and layout checks |
| [game-ui-hud](game-ui-hud/SKILL.md) | Gameplay HUD and menu integration |
| [godot-gdscript](godot-gdscript/SKILL.md) | Godot 4 scenes, typed GDScript, input, resources and verification |
| [level-design-tilemap](level-design-tilemap/SKILL.md) | Tilemap-based level construction and validation |
| [mobile-export](mobile-export/SKILL.md) | Godot and Unity Android/iOS, Phaser/Capacitor, touch, safe areas and device checks |
| [multiplayer-networking](multiplayer-networking/SKILL.md) | OpenPixo live rooms for web games, authority models, Godot/Unity/Steam/web transports and local two-instance tests |
| [performance-profiling](performance-profiling/SKILL.md) | Measured game performance investigation |
| [phaser-game-dev](phaser-game-dev/SKILL.md) | Phaser game implementation and browser verification |
| [pixel-art-consistency](pixel-art-consistency/SKILL.md) | Palette/grid/outline alignment for projects that choose pixel art |
| [player-controller-2d](player-controller-2d/SKILL.md) | 2D movement and jump behavior |
| [playtest-bug-triage](playtest-bug-triage/SKILL.md) | Reproducing and prioritizing playtest defects |
| [publish-game](publish-game/SKILL.md) | Public links for web games with `pixo publish`, when the creator asks |
| [procedural-generation](procedural-generation/SKILL.md) | Seeded generation and playability constraints |
| [save-load-and-settings](save-load-and-settings/SKILL.md) | Versioned saves and persistent settings |
| [sfx-and-music-integration](sfx-and-music-integration/SKILL.md) | Gameplay audio, music and lifecycle handling |
| [shaders-and-postfx](shaders-and-postfx/SKILL.md) | Godot/Unity/Phaser/Three.js shader effects and performance budgets |
| [skeletal-animation-2d](skeletal-animation-2d/SKILL.md) | Hand-painted cutouts, Spine/DragonBones, Godot Skeleton2D and Unity 2D Animation |
| [sprite-animation-pipeline](sprite-animation-pipeline/SKILL.md) | Frame preparation, packing and engine animation integration |
| [steam-release](steam-release/SKILL.md) | Steamworks, store art, achievements/cloud, demos, Next Fest and depots |
| [unity-csharp](unity-csharp/SKILL.md) | Unity 6 gameplay, Input System, data/assemblies and batch verification |
| [web-export-and-itch](web-export-and-itch/SKILL.md) | Tested HTML5 ZIPs and itch.io packaging |

## Adding a skill

Read [`docs/skills-protocol.md`](../docs/skills-protocol.md) for frontmatter, discovery, precedence, and mode semantics. Copy the closest functional skill, keep the folder self-contained, and use an explicit `pixo.mode` appropriate for work performed on user input.

For a rendering template, follow [`docs/skills-contributing.md`](../docs/skills-contributing.md) and [`design-templates/AGENTS.md`](../design-templates/AGENTS.md) instead.

## License

Skills in this directory are Apache-2.0 unless their own `LICENSE` says otherwise. [`web-clone/`](web-clone/) is adapted from [Jane-xiaoer/claude-skill-web-clone](https://github.com/Jane-xiaoer/claude-skill-web-clone). The MIT-licensed `guizang-ppt` rendering template lives under [`design-templates/guizang-ppt/`](../design-templates/guizang-ppt/).
