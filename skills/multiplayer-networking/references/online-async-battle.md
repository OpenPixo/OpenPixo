# Async battles with online features

A player saves a team. Other players fight that saved team later, while its owner is away. The owner sees what happened next time they play and can watch the replay. Nobody is online at the same time, so there is no lag, no host and no room.

The pieces: `put` saves the team, `pick` finds an opponent near the player's rating, a **deterministic** auto-battle decides the result from the two teams and a seed, `recordMatch` moves both ratings, and `send` leaves the defender a notice with what they need for the replay.

## 1. Save the team

Keep the saved form small and versioned. Store the numbers the battle reads, not sprites or derived state.

```ts
import { online, OnlineError, type OnlineMatch } from './openpixo-online';

export interface Unit { kind: 'knight' | 'archer' | 'mage'; hp: number; atk: number; spd: number }
export interface Team { v: 1; units: Unit[] }

export async function saveTeam(team: Team): Promise<void> {
  await online.put('teams', team);              // key 'main'; one team per player
}
```

Save when the player confirms the team, not on every edit. Rating is kept across saves; only matches change it.

## 2. Find an opponent

```ts
export async function findOpponent(): Promise<OnlineMatch<Team> | null> {
  const match = await online.pick<Team>('teams');  // near my rating, someone else, preferably not seen recently
  if (!match || match.doc.data?.v !== 1) return null;
  return match;
}
```

`null` means nobody else has a team yet. Say so in the game ("No opponents yet. Check back soon.") and offer a practice fight against a built-in team instead of a dead end. Show the opponent's `name` (or `nameZh`) and `rating` before the fight.

## 3. Fight deterministically

The same two teams and the same seed must give the same result on every device, so the defender's replay shows exactly what happened. Rules:

- Use a seeded generator, never `Math.random()`, the clock or frame timing.
- Use whole numbers for health and damage. Floating point can differ in the last digit and change who survives.
- Fix the order: sort by `spd`, then by side, then by slot. Never iterate a `Set` or object keys whose order depends on insertion history.
- Produce a list of events and animate from it afterwards. The simulation never reads the animation.

```ts
/** mulberry32: small, fast and the same everywhere. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed from the match id, so the attacker and the replay agree without sending another number. */
export function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export type BattleEvent = { turn: number; side: 0 | 1; from: number; to: number; damage: number };

export function simulate(attacker: Team, defender: Team, seed: number, maxTurns = 200) {
  const random = generator(seed);
  const sides = [attacker, defender].map(team => team.units.map(unit => ({ ...unit })));
  const events: BattleEvent[] = [];
  const alive = (side: number) => sides[side]!.filter(unit => unit.hp > 0);
  for (let turn = 0; turn < maxTurns && alive(0).length && alive(1).length; turn += 1) {
    const order = sides.flatMap((units, side) => units.map((unit, slot) => ({ unit, side, slot })))
      .filter(entry => entry.unit.hp > 0)
      .sort((a, b) => b.unit.spd - a.unit.spd || a.side - b.side || a.slot - b.slot);
    for (const { unit, side, slot } of order) {
      if (unit.hp <= 0) continue;
      const targets = sides[1 - side]!.map((target, index) => ({ target, index })).filter(entry => entry.target.hp > 0);
      if (!targets.length) break;
      const { target, index } = targets[Math.floor(random() * targets.length)]!;
      const damage = unit.atk + Math.floor(random() * 3);   // whole numbers only
      target.hp = Math.max(0, target.hp - damage);
      events.push({ turn, side: side as 0 | 1, from: slot, to: index, damage });
    }
  }
  const result: 'win' | 'loss' | 'draw' = alive(1).length === 0 && alive(0).length ? 'win'
    : alive(0).length === 0 && alive(1).length ? 'loss' : 'draw';
  return { result, events };                                // result is the attacker's
}
```

## 4. Record it and tell the defender

```ts
export async function attack(myTeam: Team, match: OnlineMatch<Team>, replaySlot: number) {
  const seed = seedFrom(match.matchId);
  const battle = simulate(myTeam, match.doc.data, seed);
  const ratings = await online.recordMatch(match, battle.result);   // once, within 30 minutes

  // An inbox message holds at most 2 KB, so the teams go in a replay entry of the attacker's own,
  // in a ring of 20 keys (a player can have 50 keys per collection).
  const key = `r${replaySlot % 20}`;
  await online.put('replays', { v: 1, seed, attacker: myTeam, defender: match.doc.data }, { key });
  await online.send(match.doc.player, { kind: 'attacked', v: 1, replay: key, defenderWon: battle.result === 'loss' });
  return { battle, ratings };
}
```

Show the attacker the fight from `battle.events`, then the new rating `ratings.you` and the change. Keep `replaySlot` in `localStorage` and add one each fight.

If `recordMatch` throws `match-expired` (the player sat on the result screen for over 30 minutes, or it was already recorded), keep the fight as played and offer a new opponent; do not fight the same match again for a different result.

## 5. The defender's side

At startup, or on the main menu, read the inbox and show what is new since last time:

```ts
export async function newAttacks(lastSeen: number) {
  const messages = await online.inbox<{ kind: string; v: number; replay: string; defenderWon: boolean }>();
  return messages.filter(message => message.id > lastSeen && message.data?.kind === 'attacked');
}

export async function replay(message: { from: string; data: { replay: string } }) {
  const doc = await online.get<{ v: 1; seed: number; attacker: Team; defender: Team }>('replays', { player: message.from, key: message.data.replay });
  if (!doc || doc.data.v !== 1) return null;        // the attacker reused the slot or left: no replay
  return simulate(doc.data.attacker, doc.data.defender, doc.data.seed);
}
```

"Brave Fox 42 attacked your team and lost. Watch?" reads better than a list of ids. Store the highest `id` seen in `localStorage` so the same notice is not shown twice. The inbox keeps 50 messages, so older ones disappear on their own.

## Testing locally

1. `pixo online add --json`, then save your own team once in the game.
2. `pixo online seed --json` adds 20 opponents with your team's shape and ratings around 1000. Use `--from team.json --collection teams` to give them a different team.
3. `pixo online test --json` and open the URL. Attack several times: the opponent changes, your rating moves after each fight, and a second `recordMatch` on the same match is refused.
4. For the defender's view, run `pixo online reset --json`, open the test URL in two browsers (or one private window), save a team in each, attack from one, then reopen the other: the notice appears and the replay ends the same way as the attack.
5. `pixo game verify --steps build --json`.

Check that the replay's events match the attacker's events exactly. If they differ, something in the battle is not deterministic.
