# Local Git experience — proposal

Status: **proposal, 2026-11-10. Nothing here is decided or built.** The owner
picks scope from §9. No product code changes until then.

The question: Codex and Claude Code show history, diffs, commits and branches,
and can run a conversation in a throwaway worktree. Should OpenPixo users get
the same?

Short answer: most of the plumbing already exists and is hidden behind 改动 and
撤销. The cheapest real wins are not Git features at all: make undo work on
machines without Git, stop the history store growing forever, and let a user
keep a version on purpose. A real Git panel is only for users who already have a
repository. "Try it in a copy" (a per-conversation worktree) is the one large
piece, and it is worth building only for web engines and Godot.

## 1. What exists today

All of it is in the daemon and goes through `/api/projects/:id/checkpoints*`,
with the same endpoints behind the web UI and `pixo project checkpoint …`.

| Piece | Where | What it does |
| --- | --- | --- |
| Isolated Git runner | `apps/daemon/src/projects/git.ts` | Runs `git` with the shell's `GIT_DIR`/`GIT_WORK_TREE`/index stripped, no hooks, no signing, identity `OpenPixo <openpixo@local.invalid>`, optional `--git-dir` so the repository can live outside the folder. |
| Automatic checkpoint per run | `checkpoint-run.ts`, `checkpoints.ts` | Before every agent run, the folder is written as a tree to a disposable index and committed to `refs/openpixo/checkpoints/<id>`; at the end, the result tree goes to `refs/openpixo/checkpoint-results/<id>` with the frozen list of changed files. HEAD, branches and the user's index are never touched. |
| Where checkpoints live | `checkpoint-store.ts` | A folder that is its own repo root: in that repo, as private refs. Anything else (managed project, imported folder without `.git`, folder inside someone else's repo): a private store at `<RUNTIME_DATA_DIR>/checkpoint-stores/<projectId>`, folder as work tree. Dependencies and engine output are excluded; over 30,000 files or 2 GiB reports `project_too_large`. |
| Worktree awareness | `checkpoints.ts` `scope()` | Checkpoint metadata carries the Git worktree it was taken in, so a linked worktree already gets its own checkpoint list. Nothing creates worktrees yet. |
| Diff and file sides | `checkpoints.ts` `diff`, `fileVersion` | Per-run unified diff with line/file caps (`CHECKPOINT_DIFF_LIMITS`), binary detection, raw before/after bytes of one file. |
| Restore | `checkpoints.ts` `restore` | Puts the whole folder back to a checkpoint. Takes a `before_restore` checkpoint first, refuses while a run is active, refuses to overwrite ignored files. |
| Conversation rewind | `routes/project/conversation-rewind.ts` | Files first, then removes the messages after a point and drops the agent session. |
| Opt-in `git init` | `checkpoints.ts` `enable` | Creates a real `.git` in the folder with one commit. Rarely needed since the store exists. |
| Web | `components/panel/ChangesView.tsx`, `components/changes/*`, `components/checkpoints/*`, `chat/TurnChanges.tsx`, `chat/RunCheckpointUndo.tsx`, `chat/UndoLastTurnDialog.tsx` | 改动 view with 本轮 / 本会话, diff viewer, snapshot history (⟲), per-turn 撤销, `/undo`. Specified in `specs/current/openpixo-game-panel.md` §5. |
| Agent access | `tool-tokens.ts`, `runtimes/read-only-turn.ts` | An agent token can read checkpoints (also in Plan mode); restore needs `writeFiles`. |

## 2. What is missing

In order of how many users notice it:

1. **No Git, no undo.** The packaged app does not ship Git. A beginner on Windows
   without Git gets `git_unavailable` ("请先安装 Git…") and no 撤销 at all. This
   hits exactly the users who need undo most.
2. **The store only grows.** Pruning keeps 50 checkpoints but deletes only refs;
   nothing runs `git gc`, so every version of every changed PNG, OGG and GLB stays
   on disk forever. Retention counts runs, not bytes.
3. **Nothing can be kept on purpose.** Every checkpoint is automatic and falls off
   after 50 runs. "The version that worked on Tuesday" can silently disappear.
4. **Undo is all or nothing.** 撤销这一轮 puts back every file the turn changed.
   "Keep the new level, undo the broken player script" needs a second turn asking
   the agent to repair it, even though the daemon can already read every file as it
   was before the run (`fileVersion`, side `before`).
5. **No view of the user's real repository.** An imported repo gets checkpoints as
   private refs, but OpenPixo never shows its branch, uncommitted changes against
   HEAD, or its log, and cannot commit.
6. **No parallel attempts.** Two conversations in one project write to one folder;
   undo is refused while any run is active. There is no "try it, then keep or
   throw away".
7. **Large files are untested.** No LFS handling at all; what `git add` does in an
   LFS repo through the disposable index (clean filter, missing `git-lfs`) is not
   covered by a test.

### How Codex, Claude Code and OpenCode compare (checked 2026-11-10)

From their docs and third-party write-ups; the Codex undo item is from a repository
mirror and not confirmed.

| | Undo | Review | Worktrees | Commit / push / PR |
| --- | --- | --- | --- | --- |
| Codex | CLI used hidden "ghost commits", Git repos only; reportedly removed in April 2026 | App diff pane: comment, stage or revert single hunks or files | Optional per thread, in `$CODEX_HOME/worktrees` (outside the repo), detached HEAD, from the chosen branch plus its uncommitted changes. Git repos only | Yes, from the app |
| Claude Code | Own checkpoints per prompt (`/rewind`); only its file-tool edits, not shell changes | Desktop diff pane | `claude -w <name>` → `<repo>/.claude/worktrees/<name>` on a branch; the desktop app makes one per session. Git repos only | Yes |
| OpenCode | Separate Git store in its data folder, work tree = project; never touches the user's history | Session diff | None found | Through the agent's shell |

OpenPixo's checkpoint store is the OpenCode design, and covers shell changes, which
Claude Code's checkpoints do not. None of the three makes a copy without a Git repo
or handles engine caches or large assets, which are the hard parts here. Codex's
single-file revert is the piece worth borrowing (gap 4).

## 3. Who sees what

The setup dialog already records `gameExperience` (`first` / `some` /
`experienced`). Use it and the presence of a real repo, not a new setting.

| User | Sees by default | Words used |
| --- | --- | --- |
| Everyone, including first-timers | 改动 (exists), 撤销这一轮 (exists), **撤销这个文件** on each changed file, a **版本** list in the ⟲ history with "存个版本" (name the current state) and "回到这个版本". | 版本, 存个版本, 回到, 对比. Never commit, branch, merge, worktree, HEAD. |
| `some` / `experienced`, no repo | The same, plus **在副本里试** when starting a conversation (Phase 3), and "变成 Git 仓库" in the project menu. | 副本, 保留, 丢弃. |
| Folder is its own Git repo (any experience) | A **Git** view in the panel: current branch, uncommitted changes against HEAD, log, commit. "Try in a copy" can also keep the result as a branch. | Normal Git words; this user chose Git. |

Push, pull, remotes, rebase and conflict tools stay out. A user with a remote
already has GitHub Desktop, VS Code or a terminal; OpenPixo should not compete
with them, only not get in their way.

## 4. Managed projects vs imported repositories

**Managed projects and imported folders without `.git`** keep using the private
store. Nothing is written into the user's folder. A "version" the user saves is a
checkpoint of kind `saved` with a name, under `refs/openpixo/saved/<id>`, exempt
from run retention. "变成 Git 仓库" (Phase 2) writes a real `.git` into the folder
whose `main` holds one commit per saved version in order, so a user who graduates
keeps the history they cared about, not 50 automatic snapshots.

**Folders that are their own repository root.** Two rules:

- *Automatic history never touches the user's history.* Checkpoints stay
  invisible: no commit on a branch, no change to HEAD or the index, no hooks.
- *An explicit commit is the user's own commit.* When the user clicks commit in
  the Git view, it behaves like `git commit` in their terminal: their
  `user.name`/`user.email` (ask once if unset), their hooks, their signing, their
  index. So it does **not** go through the isolated runner's identity and
  `commit.gpgSign=false`. The agent may draft the message from the change; only the
  user commits (refuse agent tokens, like `game-plan/approve`).

Open problem: today an own repo's checkpoints are refs inside the user's `.git`.
They show up in `git log --all`, survive into `git push --mirror` and make the
repo grow. Moving them to the private store, with `objects/info/alternates`
pointing at the user's object database so nothing is duplicated, keeps the user's
repo clean. That is owner question Q4.

**Folder inside someone else's repository** (`not_project_root`): store as today,
no Git view, because OpenPixo must not commit or show a parent repo's unrelated
files.

## 5. "Try in a copy": a worktree per conversation

### Where it lives

`<RUNTIME_DATA_DIR>/workspaces/<projectId>/<conversationId>/`, derived from
`RUNTIME_DATA_DIR` per the daemon data-root contract in `AGENTS.md`, removed with
the conversation or project the same way `removeCheckpointStore` removes a store.
Not inside the user's folder: Claude Code's `.claude/worktrees` inside the repo is
exactly what makes this repo's own `pnpm guard` overflow, and an engine would
import the copy as part of the project.

### How it is made

- The copy starts from **what the user sees now**, not from HEAD: a fresh
  checkpoint tree of the folder, uncommitted work included. (Codex does the same
  for the branch it starts from; here it also covers untracked files and projects
  with no repository.)
- Own repo: `git worktree add --detach` from the user's repo. Git records it in
  `.git/worktrees/`; no branch is created until the user keeps it as one.
  Store-backed: the same against the store's git dir.
- Excluded content is not in the tree, so it has to be rebuilt: `node_modules`
  through the existing `install-deps` path (fast with the npm cache); Godot's
  `.godot/` copied from the original folder (it is a cache, safe to copy).
  Unity `Library/` and Unreal `DerivedDataCache` take minutes to hours, so those
  engines are not offered a copy.
- Before creating it, show the disk cost (tracked bytes). Normal NTFS has no
  copy-on-write, so a 1.5 GB asset folder costs 1.5 GB more; Windows Dev Drive
  (ReFS block cloning) would make that cheap but cannot be assumed.

### Running the game from it

The conversation is bound to its workspace for its whole life. The run's cwd,
the file API, raw preview, asset index, tuning, `pixo game run`, `verify` and
`playtest` all resolve the folder through one new resolver,
`resolveConversationWorkspace(projectId, conversationId)`, instead of
`resolveProjectDir`. This audit is most of the work: every call site that today
takes only a project id. Game run already takes a `projectDir` and allocates its
own port, so the original and the copy can run side by side.

The binding is fixed because agent CLIs remember sessions by cwd (Claude Code
stores sessions per project path), so moving a conversation between folders
breaks resume.

### Keeping or throwing it away

- **保留 (keep)**: three-way merge of the copy's change (base tree → copy tree)
  onto the folder's current state with `git merge-tree --write-tree`, then the
  same guarded `read-tree -m -u` as restore, after a `before_merge` checkpoint, so
  the merge can be undone with the existing undo. Clean merge: done, copy removed.
- **Conflicts**: text files, offer "让 AI 合并" (merge the folder's current state
  into the copy, the agent resolves there, then keep again). Binary files (art,
  audio, scenes): pick one side per file, with both shown. No conflict markers ever
  land in the user's folder.
- **保留为分支** (own repo only): commit the copy on `openpixo/<name>` and stop;
  the user merges with their own tools.
- **丢弃 (throw away)**: `git worktree remove --force`, delete the folder. The
  copy's checkpoints go with it.

## 6. Large binary assets

- **No LFS of our own.** The store is local; LFS exists to keep big files off a
  server, which does not apply. Store-side cost is managed instead: run
  `git gc --prune=now` (or `repack -d` plus `prune`) after pruning, budget
  retention by bytes as well as by count, and never prune `saved` versions. A
  per-file cap (for example, files over 100 MB are listed as changed but not stored)
  keeps one video from filling the disk.
- **Respect LFS in the user's repo.** In an own repo that uses LFS, checkpoints
  must store the pointer, not the 400 MB blob, and a restore must not need the
  network. That needs a test with and without `git-lfs` installed before anything
  else ships, because today the disposable-index `git add` runs whatever filters
  the user's config names.
- **Bundled Git** (gap 1) ships without `git-lfs`. In an LFS repo with no
  `git-lfs` on the machine, checkpoints are unavailable with a clear reason
  rather than storing pointers wrong.
- **Diffs of binaries**: images already show before/after in 改动 through
  `fileVersion`; audio and models stay "changed, N MB → M MB".

## 7. Undo one file

Puts one file the run changed back to how it was before the run: the `before`
side, or no file at all if the run added it. Everything else stays.

- Same guards as a full restore: refused while a project run is active, a
  `before_restore` checkpoint first (so the undo itself can be undone), no
  ignored file overwritten, no reserved path.
- If the file has changed since the run ended (a later turn or the user edited
  it), the confirmation says so, because those later edits go too. The check
  compares the current blob with the run's recorded end tree.
- Whole files only. Codex reverts single hunks, but most game files a beginner
  cares about are art, audio and scenes, where a hunk means nothing.
- HTML file-version history is updated as `recordRestoredVersions` does today.

## 8. UI, `pixo` CLI and `/api`

Each capability lands as one change with all three surfaces (`AGENTS.md`
"Capability exposure"). Contracts go in `packages/contracts/src/api/`.

| Capability | `/api` | `pixo` | UI | Who may write |
| --- | --- | --- | --- | --- |
| Undo one file | `POST /api/projects/:id/checkpoints/:checkpointId/restore-file` (`path`, `confirmed`) | `pixo project checkpoint restore <projectId> <checkpointId> --path <rel> --yes` | 撤销这个文件 on a file row in 改动 and in the diff viewer | Same as restore: user, or agent with `writeFiles` |
| Save / list / remove a version | `POST/GET/DELETE /api/projects/:id/versions` (checkpoint kind `saved`) | `pixo project version save\|list\|remove <projectId> [--name] [--json]` | ⟲ history: 存个版本, names on saved rows | User and agent with `writeFiles` (saving is harmless) |
| Compare two versions | `GET /api/projects/:id/checkpoints/:a/diff?against=:b` | `pixo project checkpoint diff … --against <id>` | 对比 in history | Read |
| Git status / log / diff vs HEAD | `GET /api/projects/:id/git/{status,log,diff}` | `pixo project git status\|log\|diff --json` | Git view (own repo only) | Read |
| Commit | `POST /api/projects/:id/git/commit` (`message`, `paths`, `confirmed`) | `pixo project git commit -m\|--message-file … --yes` | Git view commit box with agent-drafted message | **User only**; agent tokens refused |
| Make a repo | `POST /api/projects/:id/git/init` (replaces `checkpoints/enable`) | `pixo project git init --yes` | 变成 Git 仓库 | User only |
| Copy for a conversation | `POST/GET /api/conversations/:id/workspace`, `POST …/workspace/{keep,discard}` | `pixo conversation workspace create\|status\|keep\|discard [--as-branch <name>] --json` | 在副本里试 at conversation start; keep / discard bar above the composer | Create: user. Keep / discard: **user only**, refused while a run is active |

`--prompt-file` is irrelevant here (no prompts); `--message-file <path|->` is
its equivalent for commit messages.

## 9. Phases and owner decisions

**Phase 0 — make what exists work for everyone (small, no new concepts).**
Bundle MinGit in the Windows package (Q1); `gc` and byte budget for the store;
LFS behaviour tests. Users see: undo works on a fresh machine; disk use stops
creeping.

**Phase 1 — 版本 for everyone.** Undo one file (§7) first, because it is the
smallest and builds only on existing pieces; then saved versions, compare two
versions, names in history. Three-surface closure as in §8.

**Phase 2 — Git view for real repos.** Status, log, diff vs HEAD, user commit
with drafted message, 变成 Git 仓库. Q2 and Q4 decide its rules.

**Phase 3 — Try in a copy.** Workspace resolver audit first (its own PR, no
behaviour change), then create / run / keep / discard for web engines and Godot.
Q3 decides who sees it.

**Not planned:** push/pull, remotes, GitHub sign-in, pull requests, rebase.

### Questions for the owner

- **Q1. Ship Git in the installer?** MinGit (Git for Windows' minimal build, no
  shell or GUI) is a few tens of MB compressed on top of a 352 MB installer, more
  on disk; measure before deciding. It makes undo work for users without Git and
  pins a version new enough for `merge-tree --write-tree` (Git 2.38+), which
  Phase 3 needs. Alternative: keep asking users to install Git. Recommendation:
  ship it, and prefer it over the system Git.
- **Q2. In a user's own repository, who may commit?** (a) Only the user, by
  clicking commit; the agent drafts the message. (b) The agent may also commit at
  the end of a turn if the user turns that on. Recommendation: (a) at launch.
- **Q3. Who sees "try in a copy"?** (a) `some` and `experienced` only, web and
  Godot only. (b) Everyone, worded as 副本. (c) Not now. Recommendation: (a);
  beginners already have undo, and a copy that needs a reinstall is a bad first
  experience.
- **Q4. Where do checkpoints of an own repository live?** (a) As now, private refs
  inside the user's `.git`. (b) Move to the private store with alternates, so the
  user's repo stays clean. Recommendation: (b), before Phase 2 makes the Git view
  show that repository to the user.
