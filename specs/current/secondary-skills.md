# Secondary skills (sub-skills)

Status: option (a) shipped as content (2026-11-18). Option (b-lite), the chat label, shipped the same day; see "Shipped: the chat label" below.

## Problem

The agent learns which built-in skills exist from one flat index: one line per skill with its id, name, description, triggers and staged `SKILL.md` path (`renderProjectSkillIndex`, `packages/contracts/src/prompts/skill-index.ts`). There are 31 built-in skills, filtered by engine in `selectDefaultProjectSkills` (`apps/daemon/src/game/default-skills.ts`). The agent reads a `SKILL.md` when its task fits a description, and the chat shows which skill files it read (`runtime/chat/turn-skills.ts`).

Each skill is broad: `game-ui-hud` covers HUDs, title screens, pause and settings menus, focus and scaling in five engines. That breadth is right for routing but thin on focused design craft. A skill that tells an agent "show health as a bar" does not say how a bar should drain, when an enemy bar appears, or how to check it in a playtest. Agents then produce working but undesigned results: bars that ease down slowly, damage numbers that grow with damage until they fill the screen, minimaps that are shrunken copies of the world, attacks that hit during their own wind-up.

Adding each focused job as its own top-level skill would fix the craft and break the index: every skill costs an index line on every model request (about 3,500 tokens for the catalogue, accepted by the owner on 2026-11-07, `docs/prompt-composition.md`), and twelve more near-duplicate descriptions make routing worse, not better.

Goal: focused design jobs (health bars, minimap and world map, damage numbers, inventory grids, dialogue boxes, title screens, tutorial prompts, level layout, enemy telegraphs, boss intros, reward feedback, the first minute of play) reachable from the right primary skill, with an actionable method each, without growing the per-request prompt more than a few percent.

## Constraints

- **The cached prefix stays stable.** The skill index is part of the stable prompt fingerprint. Nothing may vary it per turn or per user message (`docs/prompt-composition.md`, "Project skills and progressive disclosure").
- **No message matching.** Since 2026-11-15 the daemon does not match the user's message against skills: the agent chooses from descriptions and can pick a skill up mid-task. A chance word must not load a workflow.
- **The look is the user's.** A game's look comes from the style reference picked in planning, the user's direction and the confirmed plan (`renderGamePlanBlock`, `game-art-set`). No sub-skill may impose its own look, palette or art.
- **Agents decide non-structural changes; structural ones go back to the user.** Layout, timing, readability and representation are the agent's call. A new stat, system, attack, phase, rule or game-plan change is a proposal.
- **No change to `packages/contracts` prompt composition** on this branch.

## Options

### a. Sub-skill files under the parent, routed by a table in the parent SKILL.md

Each sub-skill is `skills/<parent>/references/<topic>.md`. The parent gains a short "Focused design jobs" section: one row per job, "for X read `references/Y.md`". The parent's triggers gain the job names in English and Chinese where that helps the agent pick the parent.

- **Daemon change:** none. Staging already copies the whole skill folder into `.pixo-skills/<folder>-<hash>/` (`cwd-aliases.ts`), the index tells the agent to "resolve side files from that SKILL.md directory", and `multiplayer-networking` already routes to `references/*.md` this way.
- **Prompt cost:** the routing table lives in the SKILL.md body, which costs nothing until the agent reads it. Only added trigger phrases enter the index. This change adds 22 phrases, about 370 bytes or roughly 90 tokens by the index's bytes/4 estimate, for a project that sees all five parents: under 3 % of the index, paid once per release as a cache break like any skill edit.
- **Discoverability:** two hops. The agent must pick the parent from the index, then read the row. Parents are already the skills an agent picks for that work, and the routing section sits right after the quick path.
- **Visibility:** reading `references/health-bars.md` does not show in the chat today; the parent shows, because the agent read its SKILL.md first.

### b. Sub-skills as first-class catalogue entries with `pixo.parent`

Each sub-skill is its own `SKILL.md` with `pixo.parent: game-ui-hud`. The catalogue knows it; the index lists it only under its parent, or not at all.

- **Wins:** the chat recognizes a read of the child's `SKILL.md` with no special case; a child can carry its own `pixo.engines`, `zh_name` and `zh_description`; Settings could switch one off; a user could import a child for a built-in parent.
- **Costs:** parsing and validating `pixo.parent` (`skills.ts`), keeping children out of the flat list in `selectDefaultProjectSkills` and `composeProjectSkillContext`, and either nesting children in the index (a change to `renderProjectSkillIndex` in `packages/contracts`) or keeping them out of it (then routing is still the parent's table, as in (a)). Integrations → Skills would list children flat unless it learns to group them. Rough size: 2–4 days across daemon, contracts and web, with tests.
- **Risk:** if children are listed in the index, the index grows by one line per child, which is the cost this design exists to avoid.

### c. Trigger-based injection of the child's index line for the turn

The daemon matches the user's message against child triggers and adds the matching child's index line to that turn.

- **Against the cache:** the line would have to go outside the stable prefix as a per-turn note, which is allowed only for host markers.
- **Against the 2026-11-15 decision:** message matching is exactly what was removed. "Add spikes" would load the hazard workflow; "第 3 阶段" never says "health bar" even when the stage builds one. A skill becoming relevant mid-task cannot be caught up front.
- Rejected.

## Recommendation

Ship (a) now; it is content only and works on every tool-capable runtime today. Next, build **(b-lite): sub-skills known to the catalogue but not to the prompt.**

- The daemon reads the frontmatter of the files a parent routes to (`en_name`, `zh_name`, already present in every shipped sub-skill) and returns them on the skill's API entry, for example `subSkills: [{ file: 'references/health-bars.md', name: { en, 'zh-CN' } }]`. That is a contract DTO field, not prompt composition.
- `host-calls.ts` recognizes a read of `.pixo-skills/<skill>-<hash>/references/<topic>.md` as using that skill, and `turn-skills.ts` reports it as `game-ui-hud/health-bars`. `TurnSkills.tsx` shows "游戏 HUD › 血条" ("Game HUD › Health bars").
- The prompt index stays byte-identical.
- Rough size: 1–2 days with tests (daemon frontmatter read and API field, contracts type, web parser and label, locale strings). It is a UI change, so it needs an entry-point screenshot in its PR.

Move to full (b) only if users ask to switch individual sub-skills off or import their own children, or if a real-run audit shows agents skip the parent's routing table. Whether agents open the right reference should be checked first with the owner's real-model audit method on a HUD task and a boss task; this branch ran no live models.

## How each sub-skill is written

Every sub-skill file:

1. **Frontmatter** with `en_name` and `zh_name` only. No `name`, so nothing can mistake it for a skill, and the names are ready for (b-lite).
2. **Opening line:** "Part of the <parent> skill; read its SKILL.md first", then what decides the look (the style reference, the confirmed plan, the parent's look rules) and what this file decides (layout, timing, readability). Colours are named as roles (damage, heal, warning), filled from the game's palette.
3. **Decide first:** a table of the questions with defaults, then one line on what the agent decides itself and what it must ask first.
4. **Readable at a glance:** concrete rules with numbers (durations, sizes, contrast, caps) that are starting values, not laws.
5. **Build it:** short engine notes for the parent's engines (Godot 4, Phaser 3, Unity 6, and web/Three.js where the parent covers them), naming the real nodes, classes and calls.
6. **Verify in a playtest:** after the parent's `pixo game verify` step, a `pixo game playtest --script` example with `capture` steps (keys are `KeyboardEvent.key` names, points in the 1280 × 720 capture viewport), what to check in the frames, and the honest limits: Godot capture injects no input, Unity has no capture.
7. **Common mistakes** as wrong → right, including the structural overreach typical for that job ("phases invented to make the boss epic", "auto-collect added because it feels better").

Bodies are English, like SKILL.md bodies: they are agent-facing. The user sees only the names.

## Shipped sub-skills

| Parent | File | Job |
| --- | --- | --- |
| `game-ui-hud` | `references/health-bars.md` | Health, shield and boss bars, hearts, low health |
| `game-ui-hud` | `references/minimap-world-map.md` | Minimap, world map, objective markers |
| `game-ui-hud` | `references/damage-numbers.md` | Floating damage and heal numbers |
| `game-ui-hud` | `references/inventory-grids.md` | Inventory grids, hotbars, item details |
| `game-ui-hud` | `references/dialogue-boxes.md` | Dialogue boxes, bubbles, choices |
| `game-ui-hud` | `references/title-screens.md` | Building a title screen (the parent keeps the look rules) |
| `game-ui-hud` | `references/tutorial-prompts.md` | Control prompts and tutorial hints |
| `level-design-tilemap` | `references/level-layout.md` | Beat sheets, landmarks, checkpoints, secrets, pacing |
| `enemy-ai-state-machines` | `references/enemy-telegraphs.md` | Wind-up, tells, danger zones |
| `enemy-ai-state-machines` | `references/boss-intros.md` | Boss entrance, name card, phases, defeat |
| `game-feel-juice` | `references/reward-moments.md` | Pickups, counters, level-ups, chests |
| `game-design-doc` | `references/first-minute.md` | The "one minute of play" in planning, onboarding |

`procedural-generation` has no sub-skill yet; a "pacing a generated dungeon" file (critical path, key and lock, room roles) is the obvious next one.

## Engine filtering

A sub-skill inherits its parent's `pixo.engines`: if the parent is out of a project's index, so are its children. Engine notes inside a file cover only the parent's engines. A sub-skill that points at another skill's file (health bars → boss intros) says "when that skill is listed", because the two parents can have different engine lists (`game-ui-hud` includes Three.js and plain web; `enemy-ai-state-machines` does not). Per-child engines need option (b).

## User-imported skills

- A user's own skill can ship `references/` and a routing table the same way; this is the standard skill folder format, not an OpenPixo extension.
- Editing a built-in parent creates a user shadow that clones the side files once (`updateUserSkill`). After that, the shadow's references are frozen: later releases' improvements to a built-in sub-skill do not reach it, and a user who rewrites the parent can drop the routing table. Known limitation; (b) would let a child update independently of a shadowed parent.
- A user cannot add a sub-skill to a built-in parent without shadowing it. That also needs (b).

## Text-only providers

A `plain` provider receives enabled workflows inline and is told companion files are unavailable. Sub-skills do not reach it. The routing table rides along in the parent's body (about 1 KB per parent within the 32 KiB budget) and names files it cannot read; the existing note tells it to ask for missing instructions. Default skills, where most parents come from, never reach text-only providers.

## Shipped: the chat label

- `listSkills` (`apps/daemon/src/skills.ts`) reads each `references/*.md` whose frontmatter has `en_name` and returns it as `subSkills: [{ id, file, displayName }]` on the skill (`SkillSubSkill` in `packages/contracts/src/api/registry.ts`). Parses share SKILL.md's mtime-keyed cache. Unnamed side files are left out.
- Nothing in prompt composition reads `subSkills`. A test composes the index and the text-only fallback with and without the field and requires identical bytes, and pins a fixture's index to `renderProjectSkillIndex` of the five index fields alone.
- `skillNamesIn` (`runtime/chat/host-calls.ts`) maps a read of `.pixo-skills/<skill>-<hash>/references/<topic>.md` to `<skill>/<topic>`, for the Read tool and for shell reads alike. `turnSkillIds` folds the parent into its sub-skills, so the line says "游戏 HUD › 血条" rather than both.
- `SkillNames.tsx` labels `<skill>/<topic>` with `chat.turnSkills.subSkill` ("{skill} › {subSkill}") in the interface language. A side file the catalogue does not name shows as its parent. The execution record's "Used skill" rows use the same labels.
- The id comes from the persisted event's path alone, so a restored conversation shows the same label as the live one; a test compares the live in-flight event sequence with its JSON round trip.

## Verification

`apps/daemon/tests/game/skill-references.test.ts` checks the shipped catalogue:

- every `references/*.md` a SKILL.md links exists, and no reference file is left unlinked;
- every routed sub-skill has `en_name` and a Chinese `zh_name`;
- after staging the real Phaser defaults the way `server.ts` does, each routed file resolves next to the `SKILL.md` path the prompt index advertises.
