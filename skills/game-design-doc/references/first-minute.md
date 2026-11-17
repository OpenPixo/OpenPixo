---
en_name: The first minute of play
zh_name: 开局第一分钟
---

# The first minute of play

Part of the game-design-doc skill; read its SKILL.md first. This file is for writing the "one minute of play" the user confirms during planning, and for checking a built game's opening against it. It decides what the player does, learns and feels in order. It never decides the look: the style reference and the user's choices in planning do. How prompts on screen look belongs to `game-ui-hud`'s `references/tutorial-prompts.md`, when that skill is listed.

## Write it as a timeline

Six to ten lines, each with a time, what the player does and what the game shows back. Written from the player's side, in plain words the user can picture, in the user's language:

```text
0:00  The game opens on the forest; the fox is already standing on a log. Pressing → runs.
0:05  A gap with grass below. Pressing jump clears it; falling just lands in the grass.
0:12  First coin trail arcs over a stump: the player learns the jump arc by following it.
0:20  A slime faces away. Jumping on it squashes it with a pop and a coin.
0:35  Two slimes, one facing the player; it lunges after a squash-and-flash warning.
0:50  A checkpoint flag, then a ledge with a view of the castle: the goal.
1:00  The player has run, jumped, stomped and dodged once, and knows where to go.
```

You write and revise the timeline. Changes to it that alter the core loop, verbs or win and loss rules go back to the user, as the parent skill says.

## Rules for a good first minute

- **Playing within five seconds.** No text screen, no menu after New Game, no cutscene longer than a few seconds before the first input matters.
- **The core verb first.** The first thing the player does is the thing they will do most. Secondary verbs come once the first is comfortable.
- **One new thing at a time**, each introduced where failing costs nothing, then used where it matters (see `level-design-tilemap`'s `references/level-layout.md` for platformers, when listed).
- **A reward in the first fifteen seconds**: a pickup, a satisfying hit, a door opening. Small and immediate.
- **Show the goal by the end of the minute**: the castle on the horizon, the timer and the first wave, the board with a target score.
- **Failure is cheap at the start.** A death in the first minute restarts within seconds, close to where it happened.
- **Teach by layout before text.** A prompt only for what the level cannot show; a word count of zero is the target for the first ten seconds.
- **The first minute shows the game's identity**: the genre's hook should be visible by the end (the build choice, the drift, the combo, the twist).

## Genre notes

| Genre | The first minute should include |
| --- | --- |
| Platformer | Run, jump, one hazard, one enemy, one checkpoint, the goal in view |
| Survivor-style action | Auto-attack hitting enemies within seconds, the first XP gems, the first level-up choice before 1:00 |
| Top-down adventure | Movement, one interaction (talk, open), one threat, the direction of the first objective |
| Puzzle | One solved puzzle that teaches the rule, one that uses it slightly differently |
| Racing | Countdown, first turn, the first overtake or a position change |
| Card or tactics | One turn with an obvious good play, its outcome animated, the enemy's response |

## Check a built game against it

After building the opening, play the first minute from New Game with a timer and compare it line by line with the timeline:

- On web, `pixo game playtest --duration 30 --json` with a script that follows the timeline's inputs, with a `capture` at each timeline line, gives frames to compare. Godot capture injects no input and Unity has no capture; play those by hand and note times.
- Mark each line as matched, late, missing or confusing. A line that is late by more than a few seconds or needs text the timeline did not have is a fix for the opening, not for the timeline.
- Report the comparison to the user in the same plain words as the timeline.

## Common mistakes

| Wrong | Right |
| --- | --- |
| A control-screen or story text before play | Playing within five seconds |
| All verbs introduced in the first room | Core verb first, others one at a time |
| The first enemy can kill on contact | First threats are safe to learn on |
| The minute described in features ("double jump, dash, combo system") | What the player does and sees, second by second |
| The goal is revealed only after several minutes | Show it by the end of the minute |
