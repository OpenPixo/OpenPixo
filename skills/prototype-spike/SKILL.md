---
name: prototype-spike
en_name: Prototype spike
zh_name: 玩法原型验证
description: "Answer one game-design or technical question with a throwaway build in the project's own engine, then record a PROCEED, PIVOT, KILL or NOT ASSESSED verdict. Not production implementation, polish, or a refactor of prototype code into the game."
en_description: "Answer one game-design or technical question with a throwaway build in the project's own engine, then record a PROCEED, PIVOT, KILL or NOT ASSESSED verdict. Not production implementation, polish, or a refactor of prototype code into the game."
zh_description: "在项目自身引擎中用一次性原型回答一个玩法或技术问题，并记录 PROCEED、PIVOT、KILL 或 NOT ASSESSED 结论；不用于正式实现、打磨，也不把原型代码重构进正式游戏。"
triggers:
  - prototype a mechanic
  - spike
  - is this fun
  - test a game idea
  - throwaway prototype
  - 玩法原型
  - 验证玩法
  - 原型验证
license: Apache-2.0
pixo:
  mode: utility
  category: game-development
---

# Prototype spike

A prototype answers one question as cheaply as possible, then gets thrown away. The user's question, the project's engine and version and its existing conventions take precedence. Work in the selected project; do not build a separate HTML mockup or switch engines unless the user asks.

## Quick path

1. Write the question as one falsifiable sentence and what result would answer it.
2. Create `prototypes/<name>/` (or the project's existing prototype folder) with a `README.md` holding the question.
3. Build only what the question needs, with placeholder shapes and hardcoded values.
4. Point the game's entry at the prototype, record the old entry, and run `pixo game verify --steps check,build,run --screenshot --json`.
5. Hand it to the user to play; record their verdict and findings in the README, then restore the entry.

Add `--project <id>` when `PIXO_PROJECT_ID` is absent. `pixo game run <projectId> --json` starts supported gameplay for the user.

## Frame one question

| Too broad | One answerable question |
| --- | --- |
| "Is my game fun?" | "Is dodging with a 0.2 s dash and 1 s cooldown satisfying against three chasers?" |
| "Prototype the combat system" | "Does parry-only melee stay readable with four enemies on screen?" |
| "Can the engine handle it?" | "Do 500 bullets with Area2D collisions hold 60 FPS on the target machine?" |

If the question grows while building, stop and narrow it. Two small prototypes answer more than one that tries to answer both.

## Build rules

- Allowed: hardcoded values, globals, copy-paste, debug output, placeholder art and sound, no menus or game over unless they are the question.
- Required: everything lives under the prototype folder. Production code never imports from it and it modifies nothing outside it, except the single entry switch.
- The entry switch is Godot `run/main_scene` in `project.godot`, the Phaser scene list or start scene, or the Unity build scene list. Record the original value in the README and restore it when the spike ends, even on KILL.
- In Unity, the folder is `Assets/Prototypes/<name>/`, because nothing outside `Assets/` is imported. Give it a scene and its own `.asmdef`, so production code cannot reference it and it references production only on purpose. A compile error anywhere still stops Play and the batch check, so delete a broken spike rather than leaving it. Play in the Editor runs the open scene, so the entry switch only matters for builds. Use `--steps check,build` in step 4: Unity has no `run` step or `pixo game run`, so the user plays it in the Editor. Deleting the folder needs its `.meta` removed too.
- Expose the numbers under test as a few named constants at the top of one file so the user can retune them between plays.
- Budget about a day. If the engine fights the build for hours, reframe the question or test it a cheaper way, such as a paper or spreadsheet model for economy questions.
- A local build cannot show how a networked mechanic feels under latency. It can show the mechanic is interesting; feel needs real peers or simulated delay.

## Verdicts

| Verdict | When | Next |
| --- | --- | --- |
| PROCEED | The question's success result was observed | Write the mechanic into the GDD; implement it fresh to project standards |
| PIVOT | Something nearby looked promising | Write the next, different question; prototype again |
| KILL | The result failed, or this is the third PIVOT on one idea | Record why; try a different idea rather than a fourth iteration |
| NOT ASSESSED | Nobody played it, or the build never reached the question | Say what blocked it; claim no result |

Whether something is fun or feels good is the user's call from playing it. Screenshots and passing checks show the build runs and the mechanic is on screen; they cannot establish feel. Building two or three variants of one question and keeping the best usually beats polishing one.

## README to adapt

```markdown
# Dash dodge spike
Question: Is a 0.2 s dash with a 1 s cooldown satisfying against three chasers?
Success looks like: the player dodges on purpose, not by luck, within a minute.
Entry switch: run/main_scene was res://scenes/main.tscn
Status: concluded 2026-11-02
Verdict: PIVOT
Findings: dash felt good; cooldown made the middle of fights passive.
Next question: does a dash that refunds on a perfect dodge keep players engaged?
```

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Clean up the prototype and ship it | Rewrite PROCEED mechanics to project standards; prototype shortcuts become production debt |
| Leave the main scene pointing at the prototype | Restore the recorded entry; the user's game should start where it did |
| Declare PROCEED from a screenshot | Ask the user to play; record NOT ASSESSED until someone has |
| Iterate one idea a fourth time | Third PIVOT forces a KILL decision; a fresh idea usually wins |

## Done when

- [ ] The README holds the question, success result, entry switch, verdict and findings.
- [ ] The verify JSON was read and its screenshots inspected, or the report says they were not.
- [ ] The original entry is restored and nothing outside the prototype folder changed.
- [ ] The report names the verdict and the next step: GDD update, next question or a new idea.
