import type { ExecFileOptions } from 'node:child_process';
import type { AgentApprovalMode, AgentDiagnostic, ModelMetadata, McpServerConfig, OpenPixoAgentPrices } from '@openpixo/contracts';
import type { RuntimeExtensionInjector } from './extension-injection.js';

export type { AgentDiagnostic } from '@openpixo/contracts';

export type RuntimeEnv = NodeJS.ProcessEnv | Record<string, string>;

export type RuntimeModelOption = {
  id: string;
  label: string;
  enabled?: boolean;
  default?: boolean;
  inputPriceUsdPerMillion?: number;
  outputPriceUsdPerMillion?: number;
  /** Hosted (OpenPixo credits) models only: the cloud's credits per million tokens. */
  creditsPerMillionTokens?: OpenPixoAgentPrices;
  metadata?: ModelMetadata;
  additionalSpeedTiers?: string[];
  serviceTierOptions?: RuntimeModelOption[];
  reasoningOptions?: RuntimeModelOption[];
};

export type RuntimeModelSource = 'live' | 'fallback';

export type RuntimeReasoningOption = RuntimeModelOption;

export type RuntimeBuildOptions = {
  model?: string | null;
  reasoning?: string | null;
  serviceTier?: string | null;
};

export type RuntimeContext = {
  cwd?: string;
  approvalMode?: AgentApprovalMode;
  /** Plan mode, including a new game before its plan is approved: the turn must not change the project. */
  readOnlyTurn?: boolean;
  /** Enabled project MCP connections; supplied per process without changing user config. */
  codexMcpServers?: readonly McpServerConfig[];
  /** Validated non-secret native provider config overrides for this process. */
  codexProviderArgs?: readonly string[];
  codexSuppressReasoningSummary?: boolean;
  // Native-resume adapters read these to decide whether to continue the
  // external runtime's own session. `resumeSessionId` is the stored id for
  // this (conversation, agent) when a prior session exists; the adapter sends
  // it through its transport and the daemon sends only the latest user turn.
  // When it is null/absent the adapter starts a new session; specify-style CLI
  // adapters may use `newSessionId` (a freshly minted UUID the daemon also
  // persists), while capture-style transports report their own id.
  resumeSessionId?: string | null;
  newSessionId?: string;
  // Per-run plugin isolation for agent subprocesses. External Plugin entry
  // points use this for Local Codex so the child cannot recursively load the
  // same Codex Plugin and route itself into another OpenPixo workflow.
  // Operator-wide overrides remain owned by each runtime definition.
  disablePlugins?: boolean;
  /**
   * Enables provider-owned native Child behavior frames for an OD Next mapped
   * Run. Runtime definitions must keep this off for ordinary Runs, and stream
   * handlers must consume the frames as an evidence-only side channel rather
   * than forwarding Child text into the parent UI stream.
   */
  observeNativeChildBehavior?: boolean;
};

export type RuntimeCapabilityMap = Record<string, boolean>;

export type RuntimeListModels = {
  args: string[];
  timeoutMs?: number;
  parse: (stdout: string) => RuntimeModelOption[] | null;
};

export type RuntimeAgentDef = {
  id: string;
  name: string;
  bin: string;
  versionArgs: string[];
  fallbackModels: RuntimeModelOption[];
  buildArgs: (
    prompt: string,
    imagePaths: string[],
    extraAllowedDirs?: string[],
    options?: RuntimeBuildOptions,
    runtimeContext?: RuntimeContext,
  ) => string[];
  streamFormat: string;
  fallbackBins?: string[];
  helpArgs?: string[];
  capabilityFlags?: Record<string, string>;
  // Flags the CLI accepts but omits from `--help`, so the substring scan in
  // `capabilityFlags` can never see them. Probed by invoking each flag with a
  // value it cannot possibly accept: a build that knows the flag rejects the
  // *value*, a build that does not rejects the *option*. Both fail before any
  // model call, which keeps the probe free.
  hiddenCapabilityFlags?: {
    // Prefixed to every probe invocation, e.g. `['-p']` for flags that only
    // exist under a subcommand.
    probeArgsPrefix: string[];
    // Flag string -> capability key, same shape as `capabilityFlags`.
    flags: Record<string, string>;
  };
  promptViaStdin?: boolean;
  // Format for the user prompt fed via stdin. Default is plain text (the
  // entire prompt buffer goes in raw, then stdin is closed). When set to
  // 'stream-json' the daemon writes a single JSONL line wrapping the prompt
  // as an Anthropic user message (so steering messages can later be
  // injected into the same stdin without re-spawning the child). Only
  // honored for adapters that also set `promptViaStdin: true`.
  promptInputFormat?: 'text' | 'stream-json';
  eventParser?: string;
  env?: Record<string, string>;
  listModels?: RuntimeListModels;
  fetchModels?: (
    resolvedBin: string,
    env: RuntimeEnv,
  ) => Promise<RuntimeModelOption[] | null>;
  reasoningOptions?: RuntimeReasoningOption[];
  supportsImagePaths?: boolean;
  mcpDiscovery?: string;
  extensionInjector?: RuntimeExtensionInjector['id'];
  // Native MCP transport used by the retained runtime.
  externalMcpInjection?:
    | 'claude-mcp-json'
    | 'opencode-env-content';
  installUrl?: string;
  docsUrl?: string;
  // Whether the model picker accepts custom runtime model ids.
  supportsCustomModel?: boolean;
  // The runtime retains a native conversation across process invocations.
  resumesSessionViaCli?: boolean;
  // Codex and OpenCode report their own native session id in stream status.
  capturesSessionIdFromStream?: boolean;
  // Side-effect-free runtime auth status probe.
  authProbe?: {
    args: string[];
    timeoutMs?: number;
  };
};

export type DetectedAgent = Omit<
  RuntimeAgentDef,
  | 'buildArgs'
  | 'listModels'
  | 'fetchModels'
  | 'fallbackModels'
  | 'helpArgs'
  | 'capabilityFlags'
  | 'hiddenCapabilityFlags'
  | 'fallbackBins'
  | 'env'
  | 'authProbe'
> & {
  models: RuntimeModelOption[];
  modelsSource: RuntimeModelSource;
  available: boolean;
  authStatus?: 'ok' | 'missing' | 'unknown';
  authMessage?: string;
  path?: string;
  version?: string | null;
  diagnostics?: AgentDiagnostic[];
  /** See `AgentInfo.vendorSignInWithoutCli`. Set only on an unavailable agent. */
  vendorSignInWithoutCli?: true;
};

export type RuntimeExecOptions = ExecFileOptions & {
  env?: NodeJS.ProcessEnv;
};

export function runtimeResumesSessionById(
  def: Pick<RuntimeAgentDef, 'resumesSessionViaCli'>,
): boolean {
  return def.resumesSessionViaCli === true;
}
