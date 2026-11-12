---
name: multiplayer-networking
en_name: Multiplayer networking
zh_name: 多人联机网络
description: "Add online features (leaderboards, saves, async battles, racing ghosts) to a web game with pixo online, live rooms with pixo rooms, or implement and debug networking authority, transport, replicated actions and two-peer tests in Godot, Unity or web games, including Steam lobby integration. Not a general chat or socket service or mandatory netcode migration."
zh_description: "用 pixo online 为网页游戏加入在线功能（排行榜、存档、异步对战、赛车幽灵），用 pixo rooms 加入在线房间，或在 Godot、Unity、Web 游戏中实现和调试联机权威、传输、动作同步与双端测试，包括 Steam 大厅集成；不用于通用聊天或套接字服务，也不强制迁移网络架构。"
triggers:
  - multiplayer networking
  - play with friends
  - live rooms
  - pixo rooms
  - pixo online
  - online leaderboard
  - leaderboard
  - cloud save
  - async battle
  - racing ghost
  - 排行榜
  - 异步对战
  - 赛车幽灵
  - 和朋友一起玩
  - 在线房间
  - Godot multiplayer
  - Netcode for GameObjects
  - rollback netcode
  - deterministic lockstep
  - Steam lobby
  - WebRTC game
  - WebSocket game
  - 多人联机
  - Steam 大厅
license: Apache-2.0
pixo:
  mode: utility
  engines:
    - godot
    - unity
    - phaser
    - threejs
    - web-generic
  category: game-development
---

# Multiplayer networking

The user's requirements and existing project conventions, engine and plugin versions and network architecture take precedence. Fix the affected action or connection first; choose a new authority model only when the task needs one.

## Web games: online features or rooms

Two OpenPixo tools cover web games (Phaser, Three.js, other Vite or static builds). Neither needs the creator to set anything up, and both work on the game's public link without code changes.

| The game needs | Use |
| --- | --- |
| Leaderboards, cloud saves, async battles (fight a team another player saved earlier), racing ghosts, messages between players | **Online features**, `pixo online` |
| Players in the same match at the same time, seeing each other move | **Rooms**, `pixo rooms` |

Choose online features unless players truly must play together live. A game can use both.

## Online features

`pixo online` gives every published web game its own small backend. Players are anonymous: the SDK registers each one on first use with a generated name such as `Brave Fox 42` / `勇敢的狐狸 42` and keeps a token in the game's `localStorage`. **Never ask players for a name, an email or a password, and add no free-text chat.** Scores come from the player's own browser and can be faked: ghosts make fakes visible, and ratings only change through matches the server handed out. Fine for fun, not for prizes. Online features are included in the creator's subscription with monthly caps; they are never charged per use. **Godot, Unity, Unreal and native builds are not covered.**

1. `pixo online add --json` puts the SDK in the game, normally at `src/openpixo-online.ts`, and prints where. Import from that file and do not edit it: an edited copy stops getting updates.
2. Write the feature with the API below. Read [async battles](references/online-async-battle.md) or [racing ghosts](references/online-racing-ghosts.md) first when the game needs one; a leaderboard or save needs only the API.
3. Save one real entry by playing, then `pixo online seed --json` adds 20 fake players shaped like it. `--collection <name>` and `--from <json file>` seed a collection the game has not written yet; `--players <n>` changes the count.
4. `pixo online test --json` prints the running game's URL wired to the local test backend (and to the local rooms relay when the game has rooms). Open it and play. An agent's token may not start project commands from the daemon: if the game is not running, start its dev server yourself and run `pixo online test --url <its local URL> --json`. A second browser, or a private window, is a second player.
5. `pixo online data --collection <name> --json` lists what the game saved; `pixo online reset --json` clears the local test data.
6. Run `pixo game verify --steps build --json`.
7. When the creator asks to put it online, run `pixo publish` (see the `publish-game` skill). The same code then uses the hosted backend, chosen automatically.

The local test backend is free, needs no account, only works on this computer and keeps the same per-game limits as the hosted one.

### Online API

```ts
import { online, OnlineError } from './openpixo-online';

const me = await online.me();                                   // { id, name, nameZh }
await online.put('scores', { level: 3 }, { score: 1200 });     // key defaults to 'main'
const best = await online.top('scores', { limit: 10 });         // by score, highest first
const mine = await online.rank('scores');                       // { rank, total } or null
const doc = await online.get('scores', { player: best[0].player });

await online.put('teams', myTeam);
const match = await online.pick('teams');                       // { matchId, doc } near my rating, or null
const { you, opponent } = await online.recordMatch(match, 'win'); // new ratings
await online.send(match.doc.player, { kind: 'attacked', won: false });
const news = await online.inbox();                              // newest first

await online.remove('teams');
await online.forgetMe();                                        // this player and all their data
```

- A document is `{ player, name, nameZh, collection, key, data, score, rating, updatedAt }`. Show `nameZh` when the game is in Chinese.
- `put` replaces that player's `data` and `score` under `collection` and `key`. For a best-score board, `get` your own entry first and `put` only when the new score is better.
- `top` and `rank` take `key`, `by` (`'score'` or `'rating'`), `order` (`'desc'` by default; `'asc'` for lap times) and, for `top`, `limit` (10 by default, at most 100). Entries without a score are left out.
- `rating` starts at 1000 and changes only through `recordMatch` (Elo, K 32). `pick` hands out another player's entry near the caller's own rating (or `by: 'score'`), preferring players it has not handed out recently. `recordMatch` takes that match within 30 minutes, once, and needs the caller's own entry in the same collection and key.
- `send` puts a message of at most 2 KB in another player's inbox; each inbox keeps its newest 50.
- Offer a "Delete my online data" button that calls `forgetMe()`.

Limits per game: 64 KB per document, 20 collections, 50 keys per player per collection, 100 results per query, 60 requests a minute per player. Collection and key names are 1 to 40 of `a-z`, `0-9`, `_` and `-`. **Do not poll.** Read when a screen opens, cache the result, and write when something changes.

Every refusal throws an `OnlineError` with a `code` and a `message` written for players; `detail` carries the server's explanation for you. Keep the game playable without the network: catch the error, show its `message` where the save or list would be, and carry on.

| Code | Meaning | What the game does |
| --- | --- | --- |
| `read-only` | The creator's monthly allowance is used up, or the account has no plan | Reads still work; show the message where a save did not happen |
| `paused` | Online features are not open yet | Show the message; play on |
| `too-large`, `bad-request` | The game sent too much, or something invalid | A bug to fix: read `detail` |
| `too-fast` | Over 60 requests a minute for this player | Cut the calls; never retry in a loop |
| `not-found` | That player or entry is gone | Refresh the list |
| `match-expired` | The match is used, older than 30 minutes or unknown | `pick` again |
| `unavailable` | No answer; the SDK already retried once | Offer a retry button |
| `emulator-missing`, `emulator-invalid` | The game runs on this computer without the `pixo online test` URL | Open the URL `pixo online test` prints |

### Local evidence

| Check | Evidence |
| --- | --- |
| Save, reload the page | The same player name and the saved entry come back |
| `pixo online seed`, then open the leaderboard or opponent list | 20 more entries with varied scores, in the right order, with the player's own rank |
| An async battle | `pick` finds an opponent, the result changes both ratings, the defender's inbox shows the notice (use a second browser as the defender after `pixo online reset`) |
| A ghost race | The ghost replays smoothly next to the player and the best time shows on the board |
| Stop OpenPixo while the game runs | The game keeps playing and shows the `OnlineError` message |

`pixo online status --json` shows whether the SDK is in the game, the local test data and, once published, this month's use against the plan and whether the public game is read-only. Clearing the public game's data deletes every player's saves, so only the creator can do it (the Share dialog, or `pixo online reset --hosted --yes` in their own terminal); an agent's attempt is refused, so do not look for a way around it. Local success shows the game's online code works; it does not show the public link does, so state what you tested.

## Live rooms

For live multiplayer in a Phaser, Three.js or other web game, with no networking already in place, use OpenPixo rooms. Players open a link and join; nobody signs in, and there is no server to write or host. **Godot, Unity, Unreal and Steam games are not covered by OpenPixo rooms**: use the sections from "Quick path" down. A web game that already has its own backend keeps it.

**One player hosts, and the server only relays messages. A host can cheat, and the room ends or moves when the host leaves. Say so when it matters, and do not use rooms for ranked or prize play.** Rooms hold at most 8 players. Each message is at most 16 KB, and each player can send at most 60 messages a second. There is no chat API, and players are ids like `p1`, not names.

1. `pixo rooms add --json` puts the SDK in the game, normally at `src/openpixo-rooms.ts`, and prints where. Import from that file and do not edit it: an edited copy stops getting updates.
2. Build a lobby: a "Create room" button, a join-by-code box, the invite link shown to the host, and `joinFromUrl()` at startup so that an opened link joins straight away.
3. Write the game loop host-authoritative, as in the example below.
4. Test two players: `pixo rooms test --json` prints two URLs. Open each in its own window, create in one and join in the other. Show both directions working, and record what each window showed.
5. Run `pixo game verify --steps build --json`.
6. When the creator asks to put it online, run `pixo publish` (see the `publish-game` skill). The same code then uses hosted rooms, chosen automatically.

`pixo rooms test` starts the game when the app can, but an agent's token may not start project commands from the daemon. If it answers that the game is not running, start the dev server yourself (for example `npm run dev`) and run `pixo rooms test --url <its local URL> --json`. The local relay is free, needs no account and only works on this computer. A browser allows about 6 connections to one address, so keep a local test to 4 windows or use a second browser.

Published rooms have free player-hours and then spend the creator's credits, up to a monthly limit per game. `pixo rooms status --json` shows usage. Only the creator can change the limit (`pixo rooms limit <credits>`), so an agent's attempt is refused; do not look for a way around it.

### Rooms API

```ts
import { createRoom, joinRoom, joinFromUrl, RoomError, type Room } from './openpixo-rooms';

const room = await createRoom();        // { hostMigration: true } keeps the room when the host leaves
const friend = await joinRoom('K7PX2M'); // case does not matter
const invited = await joinFromUrl();    // null when the page has no ?room=
```

`room` has `code`, `you`, `host`, `isHost`, `players` and `inviteUrl()`. It can `send(data)` to everyone else, `sendTo(playerId, data)`, `sendToHost(data)`, `close()` (host only) and `leave()`. Listen with `room.on(event, fn)`: `message` `{ from, data }`, `playerJoined` `{ id }`, `playerLeft` `{ id }`, `hostChanged` `{ id }`, `closed` `{ reason, message }`. Attach listeners straight after the `await`.

Every refusal throws a `RoomError` with a `code` and a `message` written for players, such as a full room, an unknown code or a creator out of credits. Show the `message`. On `closed`, return to the menu and show its `message`.

**There is no automatic reconnect.** The server gives each connection a new player id, so a silent reconnect would look like a stranger joining and could not be relied on. A dropped connection fires `closed` with reason `connection-lost`. Offer a rejoin button calling `joinRoom(room.code)`; the player returns under a new id, so the host must treat them as a new player and send them the current state. A host's refresh ends the room unless it was created with `hostMigration: true`; even then, game state only survives if your game moves it.

### Game loop: host-authoritative

Only the host simulates. Everyone, including the host, sends input through `sendToHost`; the host's own input arrives as an ordinary `message`, so there is one code path. The host checks each input, runs the game, and sends state 10 to 30 times a second with `send`. Other players draw the latest state. Read [the worked Phaser example](references/rooms-phaser-example.md) before writing this; the same shape applies to Three.js.

### Two-window evidence

| Check | Evidence |
| --- | --- |
| Create in window 1, join in window 2 by link and by code | Both show the same room code and two players |
| Each window's input moves its own player | The host's result is visible in both windows |
| Non-host leaves | The host sees `playerLeft` and the player's sprite goes |
| Host leaves | The other window returns to the menu with the `closed` message, or a new host takes over if the room uses `hostMigration` |
| A wrong code and a ninth player | The `RoomError` message is shown and the game keeps running |

Local success shows the game logic works. It does not show the hosted rooms work, so report what you tested and say so if the game has not been tried on its public link with a second device.

## Quick path

For Godot, Unity, Steam and web games with their own backend:

1. Inspect connection, identity, spawn, simulation tick and state ownership; identify the specific desynchronization or feature.
2. For new networking, establish player count and platforms, join behavior and hosting constraints; use the decision table.
3. Complete connect → spawn → one authoritative action → disconnect before expanding replicated state.
4. Run `pixo game verify --steps check --json` for Godot, `--steps check,build` for Unity or `--steps build` for web.
5. Launch two isolated game instances, test both directions and relevant failure cases, and compare evidence of authority and convergence.

Add `--project <id>` to verify when `PIXO_PROJECT_ID` is absent. OpenPixo checks and capture do not orchestrate two peers. Outside OpenPixo rooms and online features, OpenPixo does not provision a game backend.

## Separate authority, simulation and transport

| Choice | Good fit | Evidence and cost |
| --- | --- | --- |
| Authoritative client-server or listen-host model | Co-op or action games with server-owned world | Validate client intent; interpolate remote snapshots. Prediction and reconciliation need input sequences and acknowledged ticks |
| Deterministic lockstep | Bounded, reproducible turn-based or strategy simulation | Same tick inputs, RNG and ordering across targets; compare state hashes. Engine physics is not automatically deterministic |
| Rollback | Small-state latency-sensitive simulation | Take snapshots, restore state and resimulate fixed ticks; bound history and dedupe replayed audiovisual effects and achievements |

Rollback can coexist with a server. A listen host has a trust and latency advantage. Keep these choices explicit without treating one transport library as a complete netcode solution.

| Target | Transport considerations |
| --- | --- |
| Native Godot 4.3 | ENet UDP via `ENetMultiplayerPeer`; test actual remote reachability and NAT |
| Unity 6 | Netcode for GameObjects with Unity Transport (UDP, or WebSockets for a Web build); relay and lobby through the installed services or Steam package |
| Browser authoritative server | WebSocket; secure hosted pages use `wss`; bound queues because old reliable traffic can stall new state |
| Browser peer channels | WebRTC plus signaling and ICE; STUN discovers candidates, TURN relays when direct connection fails |
| Steam lobby | Discovery and identity plus a separately verified packet transport; lobby membership does not turn ENet into Steam P2P |

## Godot 4.3: establish a peer

Example on an existing stable session node, using a configurable game port unrelated to OpenPixo's daemon:

```gdscript
const PORT: int = 24567

func configure_peer(as_host: bool, address: String = "127.0.0.1") -> Error:
	var peer: ENetMultiplayerPeer = ENetMultiplayerPeer.new()
	var error: Error = peer.create_server(PORT, 4) if as_host else peer.create_client(address, PORT)
	if error != OK:
		return error
	multiplayer.multiplayer_peer = peer
	return OK
```

Creating a client is not yet connection success. Handle `connected_to_server`, `connection_failed`, `server_disconnected`, `peer_connected` and `peer_disconnected`. On leave, close the peer, clear replicated actors and return to a usable menu. See [Godot 4.3 high-level multiplayer](https://docs.godotengine.org/en/4.3/tutorials/networking/high_level_multiplayer.html).

## RPC and replication boundaries

- RPC nodes must have matching scene paths and compatible declarations on every peer.
- `MultiplayerSpawner` can own server spawning and despawning; `MultiplayerSynchronizer` can replicate selected properties. Default authority is server peer 1.
- `set_multiplayer_authority()` is not itself replicated. Apply the same policy at creation on all peers; client node authority does not grant ownership of health, inventory or results.
- For replaceable input or snapshots, `@rpc("any_peer", "call_remote", "unreliable_ordered", 0)` is a Godot 4.3 declaration option, not complete validation. A client sends to peer 1 with `rpc_id(1, ...)`.
- The receiving function requires `multiplayer.is_server()` and immediately captures `multiplayer.get_remote_sender_id()`. Map sender → owned actor on the server; validate schema, tick and sequence, finite vector bounds, state and rate before queueing intent.
- A listen host invokes the same validation helper locally with its known peer ID; `call_remote` does not run the sender's local RPC body.
- Keep simulation in a fixed tick, not packet arrival order. Include protocol and build versions, stable entity IDs and authoritative tick numbers.
- Repeated held input can be replaced by newer input; one-shot actions need acknowledgements, repetition and deduplication or reliable delivery so packet loss cannot erase a jump or purchase.
- Use reliable messages for joins, transactions and scene changes. Use separate channels when traffic classes need independence. Validate duplicates and late-join initial state.

## Unity 6: Netcode for GameObjects

Keep what the project has; Mirror and FishNet projects stay on them. This applies when `com.unity.netcode.gameobjects` is installed or new networking is in scope. Connect with `NetworkManager.Singleton.GetComponent<UnityTransport>().SetConnectionData(address, port)`, then `StartHost()` or `StartClient()`. A true result only means the attempt started: wait for `OnClientConnectedCallback`, handle `OnClientDisconnectCallback`, and call `Shutdown()` on leave.

An owner sends intent; the server resolves who sent it and applies the result:

```csharp
using Unity.Netcode;
using UnityEngine;

public sealed class NetPlayer : NetworkBehaviour
{
    public readonly NetworkVariable<int> Score = new NetworkVariable<int>(0,
        NetworkVariableReadPermission.Everyone, NetworkVariableWritePermission.Server);
    private int lastSequence;

    // Any client can invoke this by default, so check the sender. Runs locally on a host.
    [Rpc(SendTo.Server)]
    private void ScoreRpc(int sequence, RpcParams rpcParams = default)
    {
        if (rpcParams.Receive.SenderClientId != OwnerClientId || sequence <= lastSequence) return;
        lastSequence = sequence;
        // Check state, range and rate here before changing authoritative values.
        Score.Value += 1;
    }
}
```

- RPC method names must end in `Rpc`. `InvokePermission = RpcInvokePermission.Owner` restricts callers on recent 2.x releases, and older ones use `RequireOwnership`. Read the installed package's docs. `ServerRpc` and `ClientRpc` are the legacy forms.
- Every peer needs the same Network Prefabs list and build. A mismatch fails at spawn with a hash error, so check version compatibility during connection approval too (`ConnectionApprovalCallback`).
- Only the server calls `NetworkObject.Spawn` or `Despawn`. Change scenes with `NetworkManager.SceneManager.LoadScene`, not `SceneManager`, or peers diverge.
- A `NetworkVariable` reaches late joiners; a past RPC does not. Keep state in variables and one-shot events in RPCs.
- Use `NetworkTransform` and `NetworkRigidbody` for replication, and give each body one authority: a client's Rigidbody fighting the server's snapshot is the usual cause of jitter. Network state is ready in `OnNetworkSpawn`, not `Start`.
- Relay and lobbies (`com.unity.services.multiplayer`) need a linked Unity project and account, and a Steam transport needs its own verified package. Do not assume either exists.

## Web and Steam branches, only when requested

- Godot browser exports cannot use native ENet UDP. `WebRTCMultiplayerPeer` and `WebSocketMultiplayerPeer` have different setup; native WebRTC peers may require an extension. Check installed versions rather than substituting peer classes blindly.
- Rendering in Phaser or Three.js does not synchronize state. If the web game already has a backend, reuse its application protocol; validate authentication, origin, schema, message sizes and rates server-side. A published OpenPixo game can only connect to its own origin, so an outside backend will not work from its public link.
- WebRTC signaling and accepted identity remain separate from the data channel. Test relay-only and restrictive networks, with intentional ordering and retransmission settings.
- For GodotSteam, inspect the installed build, Godot ABI and native libraries; use its existing owner of initialization and callbacks. Verify any separate Steam MultiplayerPeer extension before assignment.
- Wait for completion of lobby creation or joining. Publish and validate protocol, build, mode, capacity and host mapping. Derive identity from the accepted Steam session, not a claimed client string.
- Lobby-owner transfer does not migrate simulation state. End cleanly on host loss or implement a deliberate migration protocol.
- Steam acceptance needs distinct permitted accounts and devices. Two local processes sharing a logged-in identity only test the local simulation path.

## Two-instance test

If the game already supports or the task adds `--host` or `--join <address>` through `OS.get_cmdline_user_args()`, run from the game directory in two terminals:

```powershell
godot --path . -- --host
```

```powershell
godot --path . -- --join 127.0.0.1
```

These are project-owned arguments after Godot's `--` separator, not built-in networking flags. Use the configured executable. Keep separate test save slots or profiles so instances cannot overwrite progress.

For web, start the game's actual server and join from two independent browser contexts. Tag logs with peer, entity and tick; record launch commands and ports. Stop only owned test processes.

For Unity, the `com.unity.multiplayer.playmode` package runs virtual players from one Editor, which is the quickest loop. For a closer test, launch two built players with project-owned arguments read from `System.Environment.GetCommandLineArgs()`:

```powershell
& .\Builds\Windows\Game.exe -screen-fullscreen 0 -logFile host.log --host
```

```powershell
& .\Builds\Windows\Game.exe -screen-fullscreen 0 -logFile join.log --join 127.0.0.1
```

Turn on Run In Background, or the unfocused peer stops simulating and looks like lag. Turn off Force Single Instance. Both players share `persistentDataPath` and PlayerPrefs, so give each its own test save slot.

| Test | Expected evidence |
| --- | --- |
| Both players act, spawn and despawn | One authoritative result visible on both peers |
| Forged owner, vector or rate; duplicate action | Server rejects or dedupes without corrupting state |
| Disconnect, host loss, reconnect and late join | Defined recovery or termination; no ghost actors or stale state |
| Latency, jitter, loss and reordering | Controlled results from the test transport or tool; bounded buffers and convergence |
| Deterministic model | Matching hashes and replay at the same tick, rather than visual resemblance |
| Version mismatch | Clear rejection before incompatible state is applied |

## Pitfalls: wrong → right

| Wrong | Right, and why |
| --- | --- |
| Trust a client-supplied player ID or position | Resolve ownership from authenticated sender and validate intent |
| Assume RPC authority assignment propagates | Apply consistent creation policy on every peer |
| Send each one-shot once over unreliable input | Add acknowledgement, retries and deduplication or reliable action delivery |
| Treat lobby transfer as host migration | Transfer authoritative state through a designed protocol or end the match |
| Call a LAN pass internet-ready | Test actual NAT, relay and Steam conditions separately |

## Done when

- [ ] Applicable verify command passes and two-peer evidence covers requested actions and failure cases.
- [ ] Decisions about authority, transport and protocol match the implementation. Launch instructions are reproducible.
- [ ] Report untested WAN, relay, account and external-service cases explicitly rather than claiming them from local success.
- [ ] Use `pixo game playtest --duration 10 --json` to capture one supported Godot or web instance when useful. It injects no Godot inputs, has no Unity capture and does not test peer orchestration, packet loss or Steam authentication.
