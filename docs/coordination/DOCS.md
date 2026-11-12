# OpenPixo documentation and landing source

Updated: 2026-10-25 (Asia/Tokyo). Owner: `delivery_docs`.

## Delivered files

- Root README.md and README.zh-CN.md: concise bilingual product, setup, exact fork/base attribution, provider executor/status table and delivery links.
- docs/RUNNING.md: Node 24/pnpm 10.33.2, canonical tools-dev lifecycle, current workspace-local toolchain, first-project flow, package checks and portable Windows build command.
- openpixo-internal/docs/SESSION-HANDOFF.md: replaces the stale paused state with active fork orchestration, preservation rules and exact remaining gates.
- openpixo-internal/docs/RELEASE-PLAN.md: tracks fork implementation and evidence instead of the old M0-only self-build plan.
- docs/openpixo-site/ (moved 2026-11-12 to the private `OpenPixo/openpixo-site` repository): buildless static bilingual site for Cloudflare Pages. One small inline script on the landing pages for visual effects only (no storage, no network); no dependencies, remote fonts, cloud login, telemetry, fake statistics or fake download. Artwork is labeled as concept art, not app screenshots or OpenPixo output.

The frozen alpha.2 source preserves native Codex for default/DeepSeek/OpenRouter. Reused UI, local API and CLI routing/configuration are implemented with isolated provider identity and no persisted run key; project MCP private RPC/feedback and startup identity isolation are implemented. Focused/production-boundary and final source checks/review passed. Real provider/model capabilities and new binary lifecycle remain separate evidence.

## Verification

Python standard-library HTML checks passed for both pages: language, one primary heading, navigation label, alternate language link, existing local CSS and links, and absence of scripts. Relative Markdown file links passed for all five owned documents.

The correction-pass copy was rechecked: bilingual HTML/local links, the five documentation link sets, the historical M0 snapshot path and owned-file `git diff --check` all passed. No application/model test or new visual check was run for this documentation-only pass.

Frozen alpha.2 source copy also passed relative links and heading anchors, bilingual HTML/local links, exact confirmed CLI start/continue templates, preservation of alpha.1 manifest bytes/SHA-256 values and owned-file whitespace checks. This agent ran no app/model/build/publication action.

The initial agent CUA attempt failed before a page response. The root orchestrator later completed the desktop visual check in the in-app browser using a loopback-only static server: English and Chinese pages rendered, language navigation worked, and both full-page screenshots were saved to `output/verification/site-en.png` and `site-zh.png`. The preview tab was closed and its server stopped. This establishes local desktop appearance; it does not establish public deployment or mobile-browser testing.

Sites guidance was applied in local-only mode; no Site registration, remote publication, domain or Cloudflare change was attempted. No app source, dependency, lockfile or Git commit was changed by this agent.

## Evidence refresh still required

Current source/artifact pass: README en/zh, RUNNING, handoff, release plan, landing and CHANGELOG identify alpha.2 source `c058ba3` as frozen/checked/reviewed and the local unsigned setup/ZIP as built. The new manifest/source commit, files and sizes were read directly; artifact/hash/ZIP/PE/notices checks passed according to packaging/root. Exact alpha.2 SHA-256/bytes are recorded in RUNNING.md. Actual installation/lifecycle smoke is still in progress, with no pass claimed. CLI continuation requirements remain explicit; public fork main is upstream-only. SCOPE.md locates historical M0 at `c011cc4` and ignored `.cache/m0-snapshot/`.

Verified local manifest, artifact file sizes and final `.cache/packaging/smoke.json`: unsigned setup EXE (443112488 bytes), ZIP (511927245 bytes), SHA256SUMS.txt and manifest.json (`signed: false`). Exact SHA-256 values are recorded in RUNNING.md. Full build, ZIP integrity, actual isolated install, installed Electron/daemon/Web launch, cold restart and uninstall passed. The app rendered Chinese local setup and detected Codex 0.160.0; health, renderer isolation and desktop auth passed, analytics/updating remained disabled. Uninstall left no managed processes/resources/registry/shortcuts and preserved product-wide user data.

Old alpha.1 artifacts/lifecycle and their exact manifest/hashes remain preserved as secondary historical evidence. Alpha.2 source evidence: classifier 24, selected runtime 183, Responses 6, two production provider/MCP-approval fixtures, startup/authority 118, Web routing 7 plus affected regressions/typecheck; scopes overlap and are not summed. Root final offline install/guard/typecheck and source review passed. Native 0.160.0 catalog/MCP startup probes sent no model turn. New binary static verification passed; installation/lifecycle, authentic provider/model/tool/child, signing, clean-machine/real-game and public publication remain unverified or gated. Hosted docs links still target default `main`; sync them to the actual authorized publication destination at release. E2E-only live-gate/audio assertion preparation is separate from frozen binary source and is not recorded as actual model execution.
