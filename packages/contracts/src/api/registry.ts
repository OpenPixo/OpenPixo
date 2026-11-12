import type { OpenPixoAgentPrices } from './openpixo-agent-models.js';

export type ModelCost = 'low' | 'medium' | 'high' | 'very_high';

export type ModelCapability = 'standard' | 'advanced' | 'best_quality';

export interface ModelMetadata {
  cost?: ModelCost;
  capability?: ModelCapability;
  /** Provider/catalog-declared total context window; observability only. */
  contextWindowTokens?: number;
  /** Conversation size at which the runtime compacts by itself, where the runtime states it. */
  autoCompactAtTokens?: number;
}

export interface AgentModelOption {
  id: string;
  label: string;
  /** Whether the current account/tier can use this model. */
  enabled?: boolean;
  /** Whether this is the default model for the current account/tier. */
  default?: boolean;
  /** USD price per 1M input tokens when reported by the provider/catalog. */
  inputPriceUsdPerMillion?: number;
  /** USD price per 1M output tokens when reported by the provider/catalog. */
  outputPriceUsdPerMillion?: number;
  /** Hosted (OpenPixo credits) models only: the cloud's credits per million tokens. */
  creditsPerMillionTokens?: OpenPixoAgentPrices;
  /** Provider/catalog-owned model picker metadata. */
  metadata?: ModelMetadata;
  /** Raw Codex `additional_speed_tiers` values, when the CLI catalog exposes them. */
  additionalSpeedTiers?: string[];
  /** Service tiers supported by this model, keyed by Codex config id. */
  serviceTierOptions?: AgentModelOption[];
  /** Reasoning efforts advertised for this exact model route. */
  reasoningOptions?: AgentModelOption[];
}

/**
 * A typed "what should the UI do to fix this" intent attached to an
 * {@link AgentDiagnostic}. The UI renders a button per intent and owns the
 * concrete handler (open a URL, re-run detection, write an env override,
 * clear an override). Keeping the intent typed — rather than a
 * pre-baked button label + URL — means the Settings card, the unavailable
 * grid, and (PR-B) the `pixo agent healthcheck` CLI / health-check panel all
 * render the same fix affordances from one source of truth instead of each
 * re-deriving copy and wiring.
 */
export type AgentFixIntent =
  /** Open the agent's configuration / auth docs (`AgentInfo.docsUrl`). */
  | { kind: 'openDocs' }
  /** Open the agent's install / download page (`AgentInfo.installUrl`). */
  | { kind: 'openInstall' }
  /** Re-run agent detection (the Settings "Rescan" affordance). */
  | { kind: 'rescan' }
  /**
   * Prompt the user to point OpenPixo at an explicit binary by writing
   * `envKey` (e.g. `CODEX_BIN`) into `agentCliEnv`. Used when the CLI
   * is installed somewhere PATH detection can't reach.
   */
  | { kind: 'setEnv'; envKey: string }
  /** Clear a previously-set binary override so detection falls back to PATH. */
  | { kind: 'clearEnv'; envKey: string };

/**
 * Why a CLI agent is unavailable or only partially usable, in a shape the UI
 * can render as "one-line reason + fix button(s)" instead of a silent grey
 * card. Emitted by daemon detection (PATH / executable resolution + the auth
 * probe) and reused by the connection-test / health-check surfaces so a
 * failure is always actionable.
 */
export type AgentDiagnosticReason =
  /** The binary (and any fallback names) was not found on PATH. */
  | 'not-on-path'
  /** A file matched but is not executable (missing +x / wrong PATHEXT). */
  | 'not-executable'
  /**
   * A wrapper/shim was found but its target is gone. POSIX says so with exit
   * 127; a Windows `.cmd` wrapper starts an interpreter successfully and only
   * then reports it in stderr, so the launcher's own words count too.
   */
  | 'shim-broken'
  /** A user-set `*_BIN` override points at a missing/invalid file. */
  | 'configured-bin-invalid'
  /** Installed and invocable, but the CLI is not authenticated. */
  | 'auth-missing'
  /** Installed, but auth status could not be verified. */
  | 'auth-unknown';

export type AgentDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface AgentDiagnostic {
  reason: AgentDiagnosticReason;
  severity: AgentDiagnosticSeverity;
  /** Short, human-readable, single-sentence explanation. */
  message: string;
  /** Optional longer context (e.g. the probe's stderr tail). */
  detail?: string;
  /**
   * Directories PATH detection searched, surfaced verbatim for the
   * `not-on-path` case so the user can see where we looked before being
   * asked to set an explicit binary path. Sourced from the daemon resolver,
   * never recomputed in the client.
   */
  searchedDirs?: string[];
  /** Ordered fix affordances the UI should offer for this diagnostic. */
  fixActions?: AgentFixIntent[];
}

export interface AgentInfo {
  id: string;
  name: string;
  bin: string;
  available: boolean;
  authStatus?: 'ok' | 'missing' | 'unknown';
  authMessage?: string;
  path?: string;
  version?: string | null;
  /**
   * Actionable reasons this agent is unavailable or only partially usable,
   * each carrying typed fix intents. Empty / omitted means "healthy"
   * (available and, where probed, authenticated).
   */
  diagnostics?: AgentDiagnostic[];
  models?: AgentModelOption[];
  /** Whether models came from the installed CLI or OpenPixo's static fallback. */
  modelsSource?: 'live' | 'fallback';
  reasoningOptions?: AgentModelOption[];
  /** HTTPS URL to install or download the CLI (the vendor's install page). */
  installUrl?: string;
  /**
   * Set only on an unavailable agent: the vendor's own sign-in is on this
   * computer though its CLI is not (today only Codex, e.g. the Codex desktop
   * app). The UI explains that OpenPixo needs the command-line version.
   */
  vendorSignInWithoutCli?: true;
  /** Optional HTTPS URL for configuration / auth / usage docs. */
  docsUrl?: string;
  /**
   * How the daemon forwards the user's `.pixo/mcp-config.json` external MCP
   * servers to this runtime at spawn time. Mirrors the field on
   * `RuntimeAgentDef` in the daemon. Undefined means the runtime has no
   * native MCP transport wired yet, in which case the settings UI surfaces
   * a "configure MCP in the agent's own config file" hint instead of
   * silently dropping the servers (issue #2142).
   */
  externalMcpInjection?:
    | 'claude-mcp-json'
    | 'opencode-env-content';
  /** Per-run project + global MCP injection for productized runtimes; supersedes `externalMcpInjection`. */
  extensionInjector?: 'codex-rpc' | 'claude-mcp-config' | 'opencode-config-content';
  /**
   * When `false`, the Settings model picker hides the "Custom (fill below)"
   * option and the free-text input. Undefined means custom ids are allowed.
   */
  supportsCustomModel?: boolean;
  /**
   * How the daemon writes the composed prompt to this runtime's stdin. Mirrors
   * `RuntimeAgentDef.promptInputFormat` in the daemon (same precedent as
   * `externalMcpInjection` above). `'text'` writes the prompt and closes stdin
   * immediately; `'stream-json'` wraps it as one JSONL `user` message and KEEPS
   * stdin open, which is the only way a further message can reach the model
   * mid-turn. Undefined means `'text'`.
   *
   * Read it through `agentSupportsMidTurnSteering` rather than comparing the
   * literal, so the rule lives in one place.
   */
  promptInputFormat?: 'text' | 'stream-json';
}

/**
 * Whether B11 「引导对话」 (steer the running turn) can work on this agent at all.
 *
 * Steering writes a further JSONL `user` frame onto the agent child's stdin
 * while the turn is still running. Only a `stream-json` runtime leaves stdin
 * open past the opening prompt; for every other runtime the daemon has already
 * closed it, so the write would be silently lost. UI surfaces must gate the
 * affordance on this instead of assuming every agent can be steered.
 */
export function agentSupportsMidTurnSteering(
  agent: Pick<AgentInfo, 'promptInputFormat'> | null | undefined,
): boolean {
  return agent?.promptInputFormat === 'stream-json';
}

export interface AgentsResponse {
  agents: AgentInfo[];
}


export type SkillSource = 'built-in' | 'user';

export interface SkillSummary {
  examples?: import('../plugins/manifest.js').PluginExample[];
  id: string;
  name: string;
  displayName?: Record<string, string>;
  description: string;
  descriptionI18n?: Record<string, string>;
  triggers: string[];
  mode:
    | 'utility'
    | 'prototype'
    | 'deck'
    | 'template'
    | 'design-system'
    | 'image'
    | 'video'
    | 'audio';
  surface?: 'web' | 'image' | 'video' | 'audio';
  platform?: 'desktop' | 'mobile' | null;
  scenario?: string | null;
  // Optional human-readable category (e.g. "image-generation", "video",
  // "design-systems"). Surfaced as a filter pill in Settings → Skills so a
  // large pre-loaded catalogue stays scannable. Free-form lowercase slug;
  // not part of system-prompt composition.
  category?: string | null;
  // Origin of the skill: 'built-in' lives under the repo's `skills/`
  // directory and cannot be deleted from the UI; 'user' lives under
  // `<runtimeData>/user-skills/` and is fully owned by the user (delete
  // / re-import allowed). New `import` endpoint always tags `user`.
  source?: SkillSource;
  previewType: string;
  defaultFor: string[];
  upstream: string | null;
  featured?: number | null;
  fidelity?: 'wireframe' | 'high-fidelity' | null;
  speakerNotes?: boolean | null;
  animations?: boolean | null;
  hasBody: boolean;
  examplePrompt: string;
  examplePromptI18n?: Record<string, string>;
  // True when this skill exists only to group derived `<parent>:<child>`
  // example cards. The Examples gallery hides such cards because their
  // preview would duplicate one of the derived cards and add no extra
  // information, but the entry stays in the listing so `findSkillById`
  // resolves the parent for system-prompt composition and "Use this
  // prompt" fast-create on a derived card still composes the parent's
  // SKILL.md body.
  aggregatesExamples: boolean;
}

// Body shape for POST /api/skills/import. The daemon turns this into a
// SKILL.md under `<runtimeData>/user-skills/<slug>/` and surfaces the
// freshly-listed summary in the response.
export interface SkillImportRequest {
  name: string;
  description?: string;
  body: string;
  triggers?: string[];
}

export interface SkillImportResponse {
  skill: SkillSummary;
}

// Body for PUT /api/skills/:id — update an existing skill's SKILL.md.
// The route param resolves to the canonical skill id; the daemon refuses
// updates whose body `name` differs from that id (rename = delete +
// re-import).
export interface SkillUpdateRequest {
  name?: string;
  description?: string;
  body: string;
  triggers?: string[];
}

export interface SkillUpdateResponse {
  skill: SkillSummary;
}

// Returned by GET /api/skills/:id/files — the on-disk file tree under
// the skill's directory, capped to a small number of entries to keep
// the payload bounded. Used by the Settings → Skills detail panel.
export interface SkillFileEntry {
  path: string;
  kind: 'file' | 'directory';
  size: number | null;
}

export interface SkillFilesResponse {
  files: SkillFileEntry[];
}

export interface SkillDetail extends SkillSummary {
  body: string;
}

export interface SkillsResponse {
  skills: SkillSummary[];
}

export interface SkillResponse {
  skill: SkillDetail;
}

// Design templates share the SkillSummary/Detail shape (same SKILL.md
// frontmatter, same preview behavior) but live under a separate registry
// root so the EntryView Templates surface and the Settings → Skills surface
// stay decoupled. See specs/current/skills-and-design-templates.md.
export type DesignTemplateSummary = SkillSummary;
export type DesignTemplateDetail = SkillDetail;

export interface DesignTemplatesResponse {
  designTemplates: DesignTemplateSummary[];
}

export interface DesignTemplateResponse {
  designTemplate: DesignTemplateDetail;
}

export interface HealthResponse {
  ok: true;
  service?: 'daemon';
  version?: string;
}

export type InstallInput =
  | { source: 'github'; url: string }
  | { source: 'local'; path: string };

// Plugin-compatible remote source accepted by POST /api/skills/install:
// a root `https://github.com/owner/repo` URL, `github:owner/repo`, or a public
// HTTPS `.tar.gz` / `.tgz` archive.
export interface InstallSkillRequest {
  source: string;
}

export interface InstallSkillResponse {
  skill: SkillSummary;
}

export interface UninstallResponse {
  ok: true;
}
