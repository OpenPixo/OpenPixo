---
name: game-balance-data
en_name: Game balance data and simulation
zh_name: 游戏平衡数据与模拟
description: "Tune game stats, economy and progression curves, or compare seeded combat and economy simulations. Add a pipeline for CSV, JSON or spreadsheets when needed. Not business financial modeling or a mandatory data-system rewrite."
zh_description: "调节游戏属性、经济与成长曲线，或编写带固定种子的战斗或经济模拟；按需增加表格、CSV、JSON 数据管线，不用于商业财务建模，也不强制重写数据系统。"
triggers:
  - game balance data
  - economy simulation
  - difficulty curve
  - spreadsheet to game data
  - CSV game stats
  - 游戏数值平衡
  - 经济模拟
  - 难度曲线
license: Apache-2.0
pixo:
  mode: utility
  category: game-development
---

# Game balance data and simulation

The user's balance goal and the project's existing rules, engine, version and authoring source take precedence. A cooldown change may need one value and a playtest; a new economy may justify validation, simulation and curves.

## Quick path

1. Choose the requested metric and inspect its runtime formula and data source: hits to kill, first-upgrade time, wave failure or resource exhaustion.
2. Record the baseline and target range, including player strategy and units.
3. For exposed source values, run `pixo game tuning list --json`; use a returned ID with `pixo game tuning set <id> <value> --json`. Otherwise edit the existing authoring source.
4. Compare the baseline and candidate using the same scenarios and, for stochastic rules, the same seeds.
5. Run `pixo game verify --steps check --json` for Godot or Unity, or `pixo game verify --steps build --json` for web, then play the changed encounter and compare observed results with modelled results.

Add `--project <id>` when `PIXO_PROJECT_ID` is absent. Tuning discovers supported Godot literals, scene values, `tuning.json` and `src/tuning.json`; it does not edit arbitrary CSV, curves or Unity ScriptableObjects. Re-list after structural edits. In Unity, edit the ScriptableObject's `.asset` or the serialized value on the prefab, and check that a scene override is not hiding the change.

## Match the work to the question

| Request | Smallest useful method |
| --- | --- |
| One stat feels wrong | Change one owned value; measure the affected encounter |
| A whole level range spikes | Plot values and marginal gains over the range plus boundary points |
| Economy has random rewards | Paired seeded trials with several player strategies |
| Designers need spreadsheet editing | Add deterministic conversion into the existing runtime format |
| Runtime and simulation disagree | Reconcile formulas, timing and rounding before tuning the numbers |
| "Check the balance" of a whole system | Audit every owned value against its target, then the broken shapes below |

## Audit a whole system

Compare each owned value with its stated target first: a design range, a cap or a formula's intended output. A value outside its range is an outlier; report it with its number and range. A value with no target anywhere is listed as `no stated range — not judged`, never counted as balanced. Then look for the shapes that values within range can still produce:

| System | Check | Broken shape |
| --- | --- | --- |
| Combat | Options at the same cost and tier, axis by axis | One choice is at least as good on every axis, so the others are never picked |
| Combat | Defense, healing and regeneration stacked to their caps | Net incoming damage reaches zero: an unkillable state |
| Economy | Every source and sink as a rate per minute at several stages | A loop that returns more than it costs; income growth outpacing sink growth |
| Economy | Each purchasable at the point it unlocks and later | An item that is never worth buying at any stage |
| Progression | Power and requirement curves on one plot | Dead zones with no meaningful gain; one level that jumps capability |
| Progression | Grinding an early area or skipping one | Either strategy breaks the intended pacing |
| Random rewards | Expected attempts per rarity, including any pity counter | Pity triggers later than designed or resets on the wrong event |

Report each finding with the values, the formula and a scenario that shows it. Propose the smallest owned change, then rerun the same scenario and seeds after it.

## Data pipeline, when required

Keep one authoring source and one generated game snapshot. Example CSV:

```csv
id,damage,cooldown_seconds,price
starter_sword,10,0.4,100
heavy_sword,24,0.9,250
```

- Preserve stable string IDs (`001` stays a string), explicit units, types, defaults and foreign-key relationships. Blank and zero are different inputs.
- Use a real CSV parser for quoted commas and newlines, BOM and CRLF. Define policies for locale, decimal notation and exporting spreadsheet formula values.
- Reject duplicate IDs, unknown references, nonfinite numbers, invalid enum values or probabilities and nonpositive cooldowns, with diagnostics that identify the row and column.
- Define integer currency, rounding and stable row order. Validate all rows before replacing generated output; include a schema version and source digest when the pipeline needs provenance.
- Reuse or create converter and simulator scripts owned by the project. Use its normal runner. Their filenames and commands must be discovered or implemented, not presented as built-in OpenPixo commands.
- Raw CSV or JSON in Godot must enter the export or become Resources. Unity data generation uses its existing editor pipeline. Web data follows the build's actual asset base path.
- With no Unity pipeline yet, a `ScriptedImporter` for a project-owned extension (say `weapons.stats`) can parse the source and add a ScriptableObject in `OnImportAsset`. It reimports on every edit, and `ctx.LogImportError` reports the bad row. A menu command writing `.asset` files also works; call `EditorUtility.SetDirty` and `AssetDatabase.SaveAssets`, or nothing reaches disk.
- Parse numbers with `CultureInfo.InvariantCulture`. On a machine whose locale writes `0,4`, plain `float.Parse` misreads or rejects `0.4`.
- A ScriptableObject edited in Play Mode stays changed on disk in the Editor. A player build reverts to what was saved, so tune in Edit Mode or log the values.
- A source-tuning edit to generated output will be lost on conversion; update its authoring source instead.

## Curve and timing anchors

| Question | Starting calculation | Check before trusting it |
| --- | --- | --- |
| Linear stat | `base + step * level` | Check whether levels start at zero or one, and where values are capped |
| Exponential cost or HP | `base * growth ** level` | End-range magnitude, rounding plateaus and overflow |
| Diminishing return | `cap * value / (value + halfPoint)` | Positive halfPoint and marginal gain |
| Authored progression | Table knots plus chosen interpolation | Repeated knots, discontinuities and extrapolation |
| Stationary damage | `hits = ceil(HP / damage)` | Armor, misses, invulnerability and discrete thresholds |
| Time to defeat | `windup + (hits - 1) * cooldown` for a first hit after windup | Projectile travel, startup delay, death resolution and action scheduling |

Plot the entire intended range. A smooth damage curve can still create abrupt hits-to-kill changes. Track currency sources, sinks, caps and loss conditions separately so “more income” does not conceal a broken purchase rule.

## Seeded comparisons

Reuse the game's pure rules and RNG where possible. If a prototype lacks an RNG, this bounded 32-bit generator is reproducible for toy simulations, not secure randomness or a guarantee of statistical quality:

```ts
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
```

- In Unity, seed an owned `System.Random` or a nonzero `Unity.Mathematics.Random`, not global `UnityEngine.Random`, which anything can advance. Keep rules in plain C# classes so an EditMode test can run thousands of trials without a scene.
- Record the versions of data and rules, seed set, strategy, units for ticks and time, and iteration limit. Validate finite inputs and bound each trial.
- Test exact cases before large samples: probability zero or one, one-hit enemy, unaffordable upgrade, repeated identical seed and data.
- Model novice, typical and optimized choices using actual purchase and action rules; an omniscient strategy alone cannot predict ordinary players.
- Compare rates of reaching the target, failure and bankruptcy. Include resources remaining, p10, p50 and p90 timings, and traces from extreme seeds.
- Record never-reached upgrades as censored outcomes. Label timing percentiles as conditional on successful runs when applicable; dropping failures biases results.
- Change one variable or a bounded grid to attribute differences. Shared seeds improve comparison but do not prove real-player outcomes.
- When rules consume different RNG branches, retain seed provenance but avoid assuming every corresponding random event remains paired.

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| `HP / DPS` as exact kill time | Count discrete hits and include first-hit timing |
| Edit CSV and generated JSON independently | Regenerate from one source to prevent drift |
| Use a different seed set after tuning | Reuse seeds and strategies so random variation is not mistaken for improvement |
| Average successful upgrades only | Report non-reach rate and conditional timing explicitly |
| Treat simulation as playtest evidence | Measure actual encounters to validate strategy and timing assumptions |
| Call a value with no target balanced | List it as not judged; balance is measured against a stated target |

## Done when

- [ ] The changed source, schema and values before and after are identified; old saves retain IDs and their meanings or have a deliberate migration.
- [ ] Relevant conversion, exact-case and seeded comparisons are reproducible with recorded commands and assumptions.
- [ ] Verification above passes and gameplay observations support the target metric, or disagreement is documented.
- [ ] `pixo game playtest --duration 10 --json` may provide supported local capture; it injects no Godot input and cannot establish campaign balance.
