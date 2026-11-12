---
name: game-design-doc
en_name: One-page game design document
zh_name: 单页游戏设计文档
description: "Create or revise a concise project GDD with a testable core loop, player verbs, win rules, loss rules and a playable scope. Use for gameplay decisions; not a mandatory document for an already specified code tweak."
en_description: "Create or revise a concise project GDD with a testable core loop, player verbs, win rules, loss rules and a playable scope. Use for gameplay decisions; not a mandatory document for an already specified code tweak."
zh_description: "创建或修订简明项目 GDD，明确可验证的核心循环、玩家动作、胜负规则与可试玩范围；用于玩法决策，不为已明确的代码小改动强制增加文档。"
triggers:
  - one-page GDD
  - game design document
  - define core loop
  - scope my game
  - scope creep
  - 游戏设计文档
  - 核心循环
  - 游戏范围取舍
  - 范围蔓延
license: Apache-2.0
pixo:
  mode: utility
  category: game-development
---

# One-page game design document

Use the user's scope, existing GDD, project conventions, engine and version. Revise the relevant section for a small design change; create a new page only when needed. A design step can support an already authorized implementation task without becoming a new approval gate.

## Quick path

1. Read existing design notes and inspect only the prototype files needed to distinguish current behavior from proposals.
2. Identify the player fantasy, central decision and repeatable action → consequence loop.
3. Make start, win, loss, retry and persistence rules consistent; resolve only ambiguities that change the game.
4. Fit a first playable slice of at most seven items to the requested scope, riskiest first. Name the cut systems and observable acceptance cases.
5. Save to the project's existing design path, or `docs/GDD.md` if none exists; reread the saved text against one success and one failure path.

If baseline behavior needs inspection, `pixo game run <projectId> --json` starts supported gameplay. A document-only task does not require a build or asset generation.

## Decide how much design is needed

| Situation | Response |
| --- | --- |
| Clear single-rule change | Update that rule and its acceptance case |
| Rough idea without a loop | Draft one concise page with explicit reversible assumptions |
| Choice changes the core game, such as co-op vs solo | Ask for the essential decision; continue independent inspection |
| Broad feature wish list | Select a playable slice and name scope cuts |
| Existing implementation also requested | Use the GDD to guide that work; continue within the authorized request |
| A new system joins an existing slice | Compare it with the saved slice and cut list; name what it displaces |

Avoid a genre interview for decisions the brief or prototype already answers. Mark unresolved choices beside the affected rule instead of silently deciding them later.

## Hold the slice small

- List the first playable as at most seven items, each a playable outcome rather than a system name. With more than seven, propose which items the core loop works without and move them to the cut list.
- Keep cuts on the page under their own heading. A written cut ends repeated debate; a deleted one returns as a fresh request.
- Order the build riskiest first: the least proven mechanic or the hardest technical question, not menus or the easiest art. If that item fails, little else has been built on it.
- When the user names a shipped reference game, record which part of it the slice keeps. It sets a target for feel, not a feature list to copy.
- For a scope check, compare the current plan and recent work (`git log` when the project uses git) with the saved slice and cut list. Report each addition as an addition and propose a cut or an explicit scope change; do not enlarge the slice silently.

## Compact example to adapt

This is a proposed design, not a claim about a bundled template's controls or mechanics:

```markdown
# Rooftop Courier — first playable
Status: proposed; engine/input: retain the current project setup.
Pitch: Deliver a parcel across rooftops while deciding whether coins justify risky detours.
Player/session: one player; a short retryable stage.

## Core loop
Read a landing → choose safe or coin route → run/jump → reach safety →
touch the delivery flag → retry for a better coin total.

## Verbs
- Move/jump: use inspected existing bindings; movement creates route choices.
- Collect: touch a coin; count it once and show immediate feedback.
- Retry: use the project's retry input; restore the round's initial state.

## Rules
- Start at the authored spawn with zero round coins and a readable route.
- Win on touching the flag. Coins improve the result; zero coins can still win.
- Lose on falling below the stage. Retry resets position, coins and result overlay.
- Preserve only the progress explicitly owned by the existing save system.

## Slice (build in this order)
1. Jump arc and landing readability across two rooftop gaps (least proven).
2. Coins on a risky detour, counted once with feedback.
3. Delivery flag ends the round with a coin total.
4. Fall and retry restore the round.
Reuse placeholder art.

## Cut
Shops, combat, extra levels, online scores.

## Acceptance
- Reach the flag with zero coins and with every coin; both paths win once.
- Collect two overlapping coins in one frame; each counts exactly once.
- Fall, retry and finish; coins return and no old result overlay remains.

Open decision: whole-stage retry or checkpoint, if not already established.
```

Keep the page as short as the decision permits; an arbitrary word count is not an acceptance criterion. A production asset inventory or system specification belongs elsewhere only when the task needs it.

## Map rules to the inspected project

- Record actual engine and version, input names, camera and state owners. Label paths as existing or proposed; do not imply an uninspected file already exists.
- Godot: inspect `project.godot` (`run/main_scene` under `[application]`), that scene and affected scripts. A level may own completion while the player owns movement and HUD observes state; preserve existing responsibility boundaries.
- Phaser: inspect `package.json` and the active scene. Hand-placed platforms are not a tilemap; read actual movement and gravity before budgeting jumps.
- Unity: inspect `ProjectSettings/ProjectVersion.txt`, `Packages/manifest.json` and the first enabled scene in `ProjectSettings/EditorBuildSettings.asset`. Record the render pipeline and input backend, and label existing prefabs and ScriptableObjects separately from proposed ones. Measured values live in serialized prefab data, so read those rather than script defaults.
- Preserve the active template's controls and rules for optional and required pickups unless the user requests changes.
- Tie assumptions to falsifiable cases: optional coins means reaching the goal with zero still wins; mandatory coins needs a below-threshold failure case.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| “Fun and replayable” as the core loop | Name actions, decisions and consequences that can be played |
| Feature list without win, loss or retry rules | State each transition and what resets and what persists |
| A twelve-item first playable built menus first | Seven or fewer playable items, riskiest first; the rest go to the cut list |
| Treat a proposed coin gate as current behavior | Inspect the actual goal condition and label the change |
| Prescribe autoloads or a framework rewrite in the GDD | Map responsibilities only as far as implementation needs |
| Require fresh approval after designing an already requested feature | Continue the authorized implementation; ask only for unresolved material choices |

## Done when

- [ ] The saved page is readable. Each verb has an outcome; success, failure and retry cases agree with the rules.
- [ ] Baseline facts, proposals and open decisions are distinct; the slice has at most seven items in build order and the cuts are written down.
- [ ] Report the saved path and next playable result; difficulty estimates are labelled as estimates.
- [ ] If implementation was included, run `pixo game verify --steps check --json` for Godot or Unity, or `pixo game verify --steps build --json` for web, and play the acceptance cases. Add `--project <id>` when `PIXO_PROJECT_ID` is absent.
