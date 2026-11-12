# OpenPixo project and session sidebar

User direction, 2026-10-25: use the Codex pattern of expandable projects with
sessions underneath and a new-session action beside each project. The inherited
OpenPixo project list and hidden history menu do not make this relationship clear.

- The same project/session hierarchy appears on Home and inside a project.
- Expanded projects load their conversations through the existing scoped HTTP API.
- Selecting a session opens its existing deep link and highlights the selection.
- The plus action creates a blank conversation in that project and opens it, without starting a model turn.
- Loading, read failure, create failure and rapid repeated clicks have explicit handling.
- Workspace changes cannot expose cached conversations or accept stale responses.
- Folder expansion and sidebar visibility survive navigation and reload.
- The existing history menu and HTTP/CLI conversation capabilities remain available.

Verification: focused component tests, existing project navigation regressions,
guard/typecheck, and a real browser create/switch/reload check without model calls.

## Verification on 2026-10-25

- Guard and repository-wide typecheck passed.
- The focused selection passed 127 cases. Five existing assertions in
  `App.project-create-race.test.tsx` still expect the upstream default agent or
  product name. A test-only transform loading the committed App source reproduced
  all five failures without replacing the working source or interrupting preview.
- Browser verification created one blank session beside the existing game session,
  switched back to its retained transcript, reloaded, and returned through Home.
  Both views retain the project/session hierarchy and current-session highlight.
- Sidebar open/close and its shared preference were checked. At 1024, 768, 390
  and 320px widths, the navigation stayed reachable without document overflow.
- No model turn was started by these checks. Screenshots are local QA evidence
  under `output/verification/session-sidebar/`.
