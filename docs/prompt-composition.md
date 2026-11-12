# Prompt composition

OpenPixo has one prompt composer: `composeOpenPixoGamePrompt` in
`packages/contracts/src/prompts/openpixo-game.ts`. The legacy designer charter,
metadata-driven design workflows and slim/classic switches have been removed. A
new game is planned in chat first; see [New game plan](#new-game-plan).

## Project coverage and working directory

Template creation, folder import and managed-project creation all supply a real
workspace. The daemon resolves that folder before composition and passes the
same working directory it uses for the agent process. Existing managed projects
without `metadata.baseDir` also use the game composer. Runs without a selected
project use the runtime working directory. An unknown engine asks the agent to
inspect project files; it does not select a second prompt path.

This changes no project metadata or storage layout. All data paths remain governed
by the root [Daemon data directory contract](../AGENTS.md#daemon-data-directory-contract).

## Inputs and order

The shared composer renders base behavior, the essential-question contract,
read-only skill guidance for tool-capable runs, engine profile, project art style, game setup, the
user's game experience, game plan, game shape, game media, asset recipes, verification, runtime planning notes, user/project
instructions, skills, plugin context and active stages. Optional blocks are omitted when absent.
While a new game is being planned, the engine profile is omitted until an engine is known, and
the recipe and verification blocks are omitted because the host refuses that work.

Each asset recipe entry includes its catalogue verification state. Recipes without
a passing real-provider evaluation carry an unverified note asking the agent to
inspect the output before adopting it.

`apps/daemon/src/game/prompt.ts` adds only daemon facts: the engine profile with its
tools resolved for this run, the resolved project art style, the model catalogue from `game/media-contract.ts`, and the evidence-backed plan-tool note from
`runtimes/plan-tool-note.ts`. The catalogue is filtered to what can run in this run: connected
providers, the Codex image source, and hosted images, audio and 3D models only when this project's art budget can pay
(see [Art budget](#art-budget)). The
shared media text lives in
`packages/contracts/src/prompts/media-contract.ts`; callers without a registry
use its CLI model-discovery guidance. BYOK through OpenCode receives the same
tool-capable game prompt and media policy. A plain text-only provider receives
explicit tool/filesystem limits and no dispatcher, recipe, verification or native
planning-tool instructions.

## Language and experience

`renderLanguageRule` (in the base rules) says everything the user reads is in the user's language:
replies, form copy, step and stage labels, plans and summaries. Until the user writes in another
language that is the UI locale, Simplified Chinese for `zh-CN`. The prompt, Game setup values and
tool output are English for the host, so the rule says they are no language signal and setup values
are translated when shown. The per-turn follow-up protocol restates the locale for resumed turns.

`GameProjectPromptInput.gameExperience` is app config `gameExperience` (`first`, `some`,
`experienced`), passed by `composeDaemonSystemPrompt`. It renders `## Who you are helping` after Game
setup; a first-timer gets plain words, explained terms, concrete examples, smaller steps and no
engine jargon. Absent (not asked yet) renders nothing. It is a stable input in the `instructions` section.

The execution mode keeps its existing wire identifier `design`; it now means
authorized project work. `chat` answers conversational questions without a design
brief. `plan` inspects and proposes work, waiting for execution authorization, and
the host keeps a `plan` turn read-only (`runtimes/read-only-turn.ts`).

## Project skills and progressive disclosure

Enabled project skills are advertised by the pure `renderProjectSkillIndex` in
`packages/contracts/src/prompts/skill-index.ts`, called by the daemon after skill
staging. Each line contains the skill id, display name, one-line description,
literal trigger phrases and the staged `SKILL.md` path. Before matching work,
the agent reads that file and the relevant companion files and names the skill
it used. Enabling a skill does not inline its complete workflow on every turn.

A project does not have to enable anything. `selectDefaultProjectSkills`
(`apps/daemon/src/game/default-skills.ts`) adds index lines for the functional skills that
fit the project's engine (`pixo.engines` in the skill's frontmatter; no field means any
engine, and an unknown engine rules nothing out), minus what the user switched off in
Settings (`disabledSkills`) and what the project added, switched off or selected itself.
A built-in skill must be `mode: utility`, because anything else depends on a tool
OpenPixo does not provide. Default skills are index lines only: they take no part in
trigger matching, where a chance word would load a workflow nobody asked for ("add
spikes" is not `prototype-spike`), text-only providers do not get them, and one that
could not be copied is left out because the agent could not read it. They stay out of
`activeSkillDirs`, which also becomes each runtime's extra read access.

The index is about 3,500 tokens for all 29 skills, and less once the engine is known.
That is a cost on every model request, mostly cached, accepted by the owner on 2026-11-07.

A skill whose full text is in the prompt never gets read, so the daemon reports it:
`skills_loaded` (`skillIds`) goes out once before the agent starts, for explicit
selections, plugin-bound skills and trigger matches. A skill the agent reads shows in its
tool calls. The chat combines the two (`runtime/chat/turn-skills.ts`); see
`specs/current/chat-inline-assets-and-run-status.md`.

The daemon copies every enabled, default or explicitly selected skill into the effective
working directory's `.pixo-skills/` tree before spawning Codex, Claude Code,
OpenCode or BYOK OpenCode. A copy that still matches its source is left alone, and a
`.gitignore` inside the tree keeps it out of the `git status` of an imported folder.
Index paths come from successful staging results,
including the actual hashed alias segment. A refused or failed copy uses the
source `SKILL.md` as an absolute fallback, with the existing runtime read-access
policy. Companion paths resolve from the skill directory. These staging aliases
are workspace resources governed by the root data-directory contract's exception.

Explicit `skillId`, `skillIds` and plugin-bound selections keep their complete
bodies in the game prompt; automatic context does not duplicate those canonical skill ids or directories.
Because they cost their full text every time, they stay narrow (2026-11-11): a skill picked with `@` in the
composer rides that one message's `skillIds` and is not written into the project; a project's own `skillId`
shows above the composer as an "every message" chip the user can remove (`pixo project skill <id> --clear`);
and a code recipe run sends only the recipe skills that fit the project's engine (`skillFitsEngine` in
`game/default-skills.ts`), leaving the project's enabled skills to the index.
For tool-capable runs, literal case-insensitive substring matches against the
current user message can additionally include at most two enabled workflows.
Matches use their declared trigger phrases in either language, in manifest order;
an oversized body is skipped so a later match may fit. The aggregate limit is
16 KiB of UTF-8, including headings and separators, with no partial automatic bodies.

The index participates in the stable prompt fingerprint and its skills section.
Trigger-matched bodies are appended as per-turn context outside that prefix.
Completion, follow-up and focus markers retain their separate per-turn host
contract. A trigger match alone therefore does not invalidate the cached prefix.

A `plain` text-only provider gets inline enabled workflows instead of file-reading
instructions, capped at 32 KiB of UTF-8 including headings and a truncation note.
Truncation preserves Unicode boundaries. Explicit selections remain full and
precede this fallback. The prompt states that companion files are unavailable.

The existing project extensions API (also used by `pixo extensions list --json`)
returns `contextCost`: index-line and full-body bytes plus approximate token counts
using UTF-8 bytes divided by four. The Extensions panel displays both for enabled
skills. These per-skill estimates exclude the shared heading and companion files
and are not a provider tokenizer.

## Project art style input

`GameProjectPromptInput.artStyle` is an explicit optional
`ProjectArtStylePromptInput` containing `id`, localized `title`, `prompt`,
`negativePrompt`, optional `palette`, and optional `constraints`. The daemon
resolves the project's selected style before calling the shared composer; the
composer performs no catalogue lookup, filesystem access or data-path inference.
An absent or null style omits the block.

The `Project art style` block follows the engine profile and precedes the game
media contract. It keeps new image assets consistent with the style's positive
and negative descriptions, palette, pixel size, outline, background and resolution.
Tool-capable runs are told to pass `--style <id>` to `pixo media generate` and use
the same style for image recipe runs. Text-only runs receive the visual facts
without tool-command instructions. Code-only recipes ignore art styles.

Style selection and style content are stable prompt inputs. Changing either
changes the composed stable prefix and its fingerprint. Completion, follow-up
and focus markers remain outside that cached prefix in the per-turn host protocol.

## Game setup input

`GameProjectPromptInput.gameSetup` is the explicit optional `GameProjectSetup`
from `packages/contracts/src/api/game-setup.ts`: title and studio, genre, perspective,
pitch, similar games, player modes, the game's size (`scope`: quick, crafted or long),
release answers, target platforms,
art direction (who makes the art, installed style id, written direction, palette, pixel grid,
project-relative reference images, style-sample request), base resolution and
scaling, control schemes and free-text notes. The new-game wizard, `pixo project
create-game` setup flags and `GET/PUT /api/projects/:id/game-setup` (also `pixo
project game-setup`) store it as `metadata.gameSetup`; the daemon passes it
through `gamePromptProjectInputs` in `apps/daemon/src/game/prompt.ts`. The
composer does no lookup and renders only answered fields. An absent setup omits
the block.

Owner decision (2026-11-09): the new-game dialog no longer asks where a game is sold.
A new setup's release answers are only `languages` (the UI language plus English by
default) and, for a long project, `steamLater` ("put it on Steam later"). Stores,
desktop systems, Steam App ID and features, first milestone, playtime and price still
render when an older setup, the CLI or a setup file has them. Steam is named only
when `steamLater` is set or a stored setup sells on Steam.

The `Game setup` block follows `Project art style` and precedes the game media
contract. It tells the agent these are the user's requirements and to configure
the engine to match before building features. A chosen style id is also written
to `metadata.artStyleId`, so the existing art-style block carries the style's
content; the setup block only names the id. Text-only runs keep the facts but not
the "open the reference images" tool instruction.

The block ends with what those answers ask of the build from the first scene
(`renderReleaseRequirements`), because retrofitting it costs far more than starting with it:
string tables and fonts for more than one language; for a desktop store, a desktop build,
a settings screen and per-user saves; for Steam Deck, Valve's controller, resolution and text
rules; for Steam, when to do Steamworks work and tracking generated assets for its AI
disclosure; for `steamLater` without a Steam store, per-user saves and room for a
desktop build, with Steamworks left until the user asks. A setup that answers none of
this renders as it did before.

Setup content is a stable input attributed to the `project` section of
`runtimes/stable-prompt-sections.ts`. The first agent turn after the wizard is an
ordinary user message (the web `kickoffPrompt`), not prompt text; the plan block tells the
agent to confirm what it calls decided briefly and to follow its steps even when it names a
shorter route.

While the plan is pending the block calls the setup answers starting points to confirm with
the user rather than requirements. A style's own palette renders as a suggestion; only a palette
the user set (Game setup or chat) is a requirement.

## New game plan

Owner decision: every new project is planned in chat before work starts.
`GameProjectPromptInput.gamePlan` carries `metadata.gamePlan`'s status plus daemon
facts: engines this machine can run (`gameEngineOptions` in `apps/daemon/src/game/plan.ts`)
and the installed art styles. The composer does no lookup.

Owner decision (2026-11-10), replacing the earlier "a quick game gets one round" and "build
what it says, do not re-interview" rules: while `status` is `planning`, the `New game plan` block
follows `Game setup` and walks five steps, `GAME_PLAN_STEPS`: 玩法 Gameplay, 画风 Art, 引擎与技术
Engine and tech, 计划 Plan, 制作 Build. Every planning reply starts with the step label in the
user's language ("第 2 步 / 共 5 步：画风"). A step may take several turns, each with one short
`<question-form>` of concrete, recommended options; every step ends with the user's confirmation,
and two steps never share a form. A step is never skipped because Game setup answers it.

- Gameplay covers the second-to-second actions, goal, win and loss, controls, what makes it fun
  and the first version's size, and ends with a "one minute of play" the user confirms.
- Art makes 2-3 small style samples of the confirmed game (`concept/style-<n>.png`) and the user
  picks one or asks for changes; the pick is the style reference the plan names. Samples are free
  with an own key or Codex. With only budget-paid models they cost about
  `ART_BUDGET_ESTIMATE_CREDITS.image` each. With no image model the agent asks whether to make them
  with credits and points at the approve bar's budget field and its Save button, which only the
  user can use (see [Art budget](#art-budget)); otherwise it describes styles in words with
  reference games. The host still caps planning at `GAME_PLAN_CONCEPT_IMAGE_LIMIT` images.
- Engine and tech is one confirming sentence when the engine is chosen and ready. A missing
  tool is raised and the user asked to install it or switch; an unchosen engine is recommended
  only from the ready ones (Phaser preselected for a quick game).
- The plan, short and in plain words, lists 3-6 build stages: stage 1 is the smallest playable
  core loop, and each says what the user can try at its end and which art it needs.

A quick game (`gameSetup.scope === 'quick'`) keeps every step, each short: 2 samples and 3 stages.
The block also tells the agent not to ask where the game is sold, which systems or its price.

The engine profile a run states has its tools resolved for that run
(`promptEngineProfile` in `apps/daemon/src/game/prompt.ts`): a new game is detected
from its folder, and a stored profile keeps its detection but re-resolves each tool
with the configured engine paths. When a tool is missing, the engine block tells the
agent to say so plainly and wait for the user to install it, locate it in Settings or
switch engine before building anything that needs it. Before approval the agent makes only the style samples of the art step;
the media contract's rule about making art applies only after approval, and
this block says so rather than the media contract.

The agent cannot end planning. It asks the user to press the approve button
(`GAME_PLAN_APPROVE_LABELS`, shared with the UI wording), and `Plan mode` is forced
for the run regardless of the client's mode. Approval records the newest agent message in the
project, without question forms or host markers and capped at `GAME_PLAN_RECORD_MAX_CHARS`, as
`metadata.gamePlan.approvedPlan` (`approvedPlanText` in `apps/daemon/src/game/plan.ts`). The
transcript a fresh session is seeded with can drop it (another agent's turns cut it, a long message
is truncated), so the approved block quotes it in `<approved-plan>`; a plan approved before this
falls back to "your last message before their approval".

After approval the block says to build one stage per turn: start with the stage label ("阶段 1 /
共 4：能玩的最小版本"), taken from the last label in the conversation (no daemon state), build only
that stage, verify it, say exactly how to try it, end with a `<question-form>` to go on or change
something, and never start the next stage before the user says so. Before generating art it lists
what it will make (and the credits, when budget-paid) and waits for the user's OK. The starters
follow while no engine exists. The status and the recorded plan are stable inputs attributed to
the `project` section, so approval resends the instructions to a resumed session.

`renderGamePlanTurnNote` restates the step or stage label and the user's language in the
per-turn slice beside the art budget note. It is static per status, but a resumed session is not
sent the stable prompt again, and these are the rules the user notices when they slip.

A project with no `gamePlan` (an imported game, a project from before the rule, a
caller that opted out with `skipDiscoveryBrief`) gets no block and proceeds on
reasonable assumptions. See the root `AGENTS.md`, "Planning a new game", for the state,
approval and enforcement rules.

## Art budget

The user approves an art budget in credits together with the plan, and an agent may then spend up to
that amount on hosted images, audio and 3D models (`game/art-budget.ts`, `routes/art-budget.ts`).
While a project has a budget with credits left and the user is signed in,
`game/media-contract.ts` adds the hosted image, audio and 3D models after every own tool and the media contract
states the rules, audio's limits included. That is a stable input: it moves only when hosted models come or go.

The figures change with every image, so `renderArtBudgetTurnNote` sends them in the per-turn slice with
the host protocol markers, never in the cached prefix. When the budget is used up the note replaces the
"no image model" sentence, because the honest next step is raising the budget. The plan block asks for
an estimate of images and credits, and says the user sets the budget on the approve bar.

Owner decision (2026-11-10): a budget the user saves before approval (the approve bar's Save
button, `pixo game plan budget`) pays for planning's style samples. The plan gate still allows a
planning agent only images, at most `GAME_PLAN_CONCEPT_IMAGE_LIMIT`, and
`prepareAgentHostedRequest` refuses hosted audio and 3D until approval. No agent path sets a budget.
In a new game with an approved plan, the budget caps spending but is not consent for each piece:
the agent lists the art it will make (and its credits) and waits for the user's OK.

Owner decision (2026-11-11): each project has a spending mode, `ask` (the default) or `auto`
(`ArtSpendingMode` in `api/art-budget.ts`). In `ask` mode the host pays only for art the user
approved on an art card: the agent ends its reply with `<art-request credits="N">` (syntax and parser
in `api/art-request.ts`, taught by "Asking before spending" in the media contract), the chat draws it
with an Approve button, and the click calls `POST /api/projects/:id/art-budget/approve`, which refuses
an agent's token. One approval pays for one run, the first that spends from it, up to N and within the
budget. A refused request gets the `approve-art` next step, which tells the agent to end with a card
rather than report an error. Planning's style samples need no card. In `auto` mode the agent says what
it is making and makes it within the budget. The mode and any open approval travel in the per-turn note
(`renderArtBudgetTurnNote`'s `spending`); the card rules are stable text, present whenever something
is paid from the budget. Image recipes run by an agent may be paid from the budget too, one candidate by
default, each candidate priced and reserved like an image before the run starts.

## Agent image model

The user picks the image model the agent makes art with apart from the chat agent: app config
`agentImageModel` (Settings → media, the composer's 生图 chip, `pixo config set agentImageModel <id|auto>`;
`GET /api/media/agent-image-models` and `pixo media image-models` list the choices). Absent means automatic,
today's order: Codex when signed in, then the first own text-to-image model, then hosted images when the art
budget can pay. The daemon reads the pref for every run and passes it to `composeGameSystemPrompt` as
`agentImageModel`, a stable input attributed to the `media` section. `gameMediaModelCatalog` makes it the
`defaultImageModel` when it can run here, ahead of a BYOK provider's own image default; a model the user names in
chat still wins. A hosted pick runs only when the art budget can pay, so it opens no spend path around the budget.
A pick that cannot run (`not-connected`, `needs-art-budget`, `unknown-model`) falls back to automatic, and the
media contract gives the agent one sentence per reason to tell the user. Writes refuse an id that is not a
text-to-image model of this version; reads keep a saved id a later version dropped, so runs report it instead of
breaking.

## Game shape

The `A game is a game` block is always present. A browser-engine game is one
full-viewport canvas with every screen drawn as an in-game scene; a landing page or a game
in a box is ruled out by name, and web-design skills, including global ones the
runtime loads on its own, must not shape it. This rule is prompt text: a global skill is
loaded by the runtime, outside the host's control. The web starters in `game-templates/` have
the same shape.

## Image generation style merge

Image generation and image recipe runs accept an optional `styleId`. Omitting it
uses the project's default art style; an explicit null requests no style. Other
media types and code-only recipes do not apply image styles.

With a style selected, the effective image prompt is composed in this deterministic order:

1. The request's positive prompt.
2. The style's positive `prompt` fragment.
3. Labeled style constraints, in order: palette, pixel size, outline, effective
   background, effective resolution.
4. One `Avoid: <base negative>, <style negative>` block, omitting empty fragments.

Explicit request background and resolution override the corresponding style
defaults. The constraint text uses those effective values, so it cannot ask for
a different background or resolution from the actual generation request.

## Autonomous art and final image size

The game media contract's `When to make art, and at what size` section tells
the agent to make missing visual assets without being asked for "an image" (in a new game built
from an approved plan after listing them and getting the user's OK, elsewhere on its own), and to pass the final size (`--size`/`--width`/`--height`, long edge at
most `IMAGE_OUTPUT_MAX_EDGE`) and `--transparent` as flags rather than prompt
words. The cap in that text comes from the contracts constant, so the prompt
and the daemon clamp cannot drift apart. After the art-style merge the daemon
adds provider-specific size and keyable-background hints to the provider
prompt only. Provenance keeps the merged request prompt. See
[agent-image-generation.md](agent-image-generation.md) for the request, pixel
shaping and the events a generation produces.

Steps a weaker model misapplies live in the tools, not the text (2026-11-11). Small art in one style and
animation frames are one `media generate --sheet <C>x<R> [--names …] [--frames]` call
(`MediaGenerationRequest.sheet`, `api/media-sheet.ts`): the route writes the layout into the prompt and picks
the grid's shape before anything is priced (`media/sheet-request.ts`), the render carries no size so its
cutout is not cropped to the subject, and `media/image-sheet.ts` cuts the grid from the size actually
returned and writes each piece under its name; `--frames` puts them on one canvas, one scale, feet on one
line. `pixo asset frames check|align` measure and fix frames deterministically and answer in numbers plus
one sentence per problem, so a model that cannot see images can judge them. Every image's `file.note` says
what was rendered, what the file became and what it cost (sizes and credits only, never a vendor or link).
The "Small art in one image" and "Characters that move" sections teach only these commands.

## Host contracts that remain

| Contract | Single source and consumer |
| --- | --- |
| Questions | The game prompt teaches inline `<question-form>` with a JSON body. AssistantMessage renders QuestionFormView; `formatFormAnswers` sends answers as the next user message. No native question tool, tool-result endpoint or stdin answer injection exists. |
| Asked-question analytics | `apps/daemon/src/runtimes/run-artifacts.ts:runAskedUserQuestion` scans streamed text, including markers split across chunks. It is independent of composer selection. |
| Engine and media | The engine profile, game verification and shared game media contract preserve asset roots, import sidecars, model allowlists, BYOK defaults and failure handling. |
| Runtime planning | `runtimes/plan-tool-note.ts` names Codex update_plan, Claude TodoWrite/TaskCreate/TaskUpdate and OpenCode todowrite. Parser recordings remain the evidence for those names. |
| Completion/follow-up/focus | `packages/contracts/src/prompts/chat-turn-host-protocol.ts` renders keyed per-turn markers outside the cached prefix. |
| Resume/cache | `runtimes/stable-prompt-sections.ts` attributes input drift. The full stable-prompt fingerprint remains the sole decision for resending instructions. The hosted agent resumes its OpenCode session like the `opencode` agent, because GPT-6 reuses a cache only when a request opens with exactly what an earlier one sent, and it charges to write it; `apps/daemon/tests/openpixo-agent-prompt-cache.test.ts` holds that with the real binary. Switching in or out of Plan mode changes the tool list and the stable prompt, so that one turn misses the cache and resends the instructions. |
| MCP and research | Authenticated MCP guidance lives in `mcp/connected-directive.ts`; the research CLI contract lives in `research/prompt-contract.ts`. They remain tool instructions, independent of design workflows. |

Question forms are allowed on any turn, for missing information that prevents
useful progress and for planning a new game. The canonical contract includes control types, stable ids,
localized labels and option values; retired style surveys and annotation context
are absent. Do not duplicate that text in another composer.

## Scripted playtesting

The verification block teaches `pixo game playtest --script <file|-> --duration <seconds> --json` for gameplay and interaction changes. The shared `GamePlaytestRequest` accepts bounded wait/key/click/move/mouseDown/mouseUp/drag/capture steps, a duration of at most 30 seconds, and a capture interval; at most 24 frames are retained. Pointer coordinates use a 1280×720 viewport. `move` hovers or aims, paired `mouseDown`/`mouseUp` steps hold and release the left button, and `drag` specifies `from`, `to` and optional `durationMs` for a smooth left-button gesture.

`pixo game playtest --list-presets --json` lists observe, runJump, wasd, clickGrid, drag, random and monkey. `pixo game playtest --preset <id> [--seed <n>] --json` expands a shared preset instead of reading `--script`. Random and monkey accept a seed from 0 to 4294967295; the report records even an automatically chosen seed so the same preset and seed replay the same inputs. Agents select or customize inputs to exercise the changed behavior, then inspect frames, console/page errors and measured rAF min/average FPS before reporting results. Godot movie capture has no input replay and reports no measured FPS.

Playtesting reuses verification artifacts. The desktop host only drives a loopback page; agent project commands stay in the CLI child and use the existing verification context/capture/register endpoints. UI and normal CLI callers use `POST /api/projects/:id/game/playtest`. An unavailable renderer or engine is reported explicitly, and does not count as a passing check.

The Verification block defines "playable" (2026-11-11): a playtest in this run drove the core loop with real input (move, reach the goal, lose) and the game answered; startup, a menu or a still screenshot is not playable. Every build stage ends with that playtest and the reply says what was tried and what happened; where the host cannot send input (Unity, Godot movie capture) or playtest is unavailable, the stage is reported as not playtested. The build-stage rule and `renderGamePlanTurnNote` point at it. The capture host is the desktop sidecar: a web-only `tools-dev run web` has none and reports `SCREENSHOT_HOST_UNAVAILABLE`; the packaged app and a full `tools-dev` run have it.

## Validation

Shared prompt behavior is covered by contracts `openpixo-game-prompt.test.ts` and
`game-plan-prompt.test.ts`; the plan gate by daemon `game/game-plan.test.ts`,
`game/game-plan-run-gate.test.ts` and `runtimes/read-only-turn.test.ts`.
Daemon tests cover game media parity, model policy, Plan mode, skill boundaries,
runtime plan-tool names and stable-prefix drift. Cross-boundary question-form
guards compare the shared contract with the renderer. Session/run tests continue
to cover completion markers, question analytics and resumed conversations.
