# Native provider fidelity audit

Audited 2026-10-25. This is a contract/evidence report, not live-provider acceptance.

## Scope finding

`FIRST-RELEASE-SCOPE.md` (openpixo-internal: `docs/FIRST-RELEASE-SCOPE.md`) requires default Codex, DeepSeek and OpenRouter within the Codex execution layer, with Claude/OpenCode executors deferred. Routing these provider selections through inherited `byok-opencode` violates that boundary. Reuse the existing API form, credential snapshot, daemon run lifecycle and Codex adapter; no second agent engine or protocol proxy is needed. Corrections are in progress separately from this audit.

## Executable native contract

Keep the existing `ByokChatProviderConfig` request. A shared pure classifier should accept `apiProtocol: openai` and canonical HTTPS endpoints, normalize optional trailing slashes, and select `agentId: codex`. Do not reinterpret Anthropic presets or arbitrary compatible gateways. Preserve the selected model exactly after validation.

| Provider | Canonical base | Authentication | Model metadata |
| --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | A dedicated provider `env_key`; secret only in the child environment | Official model definitions in an owned `model_catalog_json` file |
| OpenRouter | `https://openrouter.ai/api/v1` | Native command-backed `auth`, reading the dedicated environment key through a fixed executable/argument vector | Native discovery at `/models?client_version=0.160.0`; retain provider-returned modalities, instructions, reasoning and tools |

Both use independent provider IDs, `wire_api: responses`, `requires_openai_auth: false` and `supports_websockets: false`, supplied through per-process `-c` overrides. These are real fields in the [exact 0.160.0 provider implementation](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/model-provider-info/src/lib.rs) and [configuration schema](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/core/config.schema.json). Native auth accepts `command`, `args`, optional absolute `cwd`, `timeout_ms` and `refresh_interval_ms`; it cannot be combined with `env_key` or OpenAI authentication. Never interpolate a credential into argv or command text.

OpenRouter's [official integration](https://openrouter.ai/blog/tutorials/codex-cli-openrouter/) requires a complete `organization/model` slug and recommends command auth because plain `env_key` does not activate default-path catalog discovery. Do not manufacture text-only/GPT-equivalent metadata for unknown models. `model_catalog_url` is a real alternative, but is unnecessary for this path; explicitly configured URLs reject redirects and cap responses at 1 MiB. A local `model_catalog_json` takes precedence and prevents remote discovery. Keep provider homes/configuration under the resolved `RUNTIME_DATA_DIR`, separate from the user's default Codex settings; preserve deliberate MCP/prompt/environment composition. See [official catalog contract](https://learn.chatgpt.com/docs/model-catalogs) and [version-pinned discovery implementation](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/model-provider/src/models_endpoint.rs).

## DeepSeek model differences

The [official Codex catalog](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/) names `deepseek-flash` (text/image) and `deepseek-v4-pro` (text). Both declare 1,048,576 context tokens, reasoning efforts `low/high/max` with default `high`, freeform `apply_patch` and multi-agent metadata `v2`. The older `deepseek-v4-flash` entries are retired aliases. Update the direct OpenAI preset only.

The [Responses compatibility table](https://api-docs.deepseek.com/guides/responses_api/) supports function tools and the custom `apply_patch` tool. Server web search is Pro-only; Flash accepts images. This does not establish native image generation or provider-side MCP/computer-use support. Codex-hosted tools/skills/MCP are separate. Request `reasoning.summary` is accepted but produces no summary; input reasoning summary/encrypted content is unsupported, and unsupported parameters are generally ignored. Do not report these as a rejected request. Omit/disable the forced detailed summary for this route.

Catalog wrapper: `{models:[...]}`. The [0.160.0 `ModelInfo` type](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/protocol/src/openai_models.rs) defines the exact shape. Accepted literals include `shell_type: shell_command`, `visibility: list`, `truncation_policy: {mode: tokens, limit: 10000}`, and reasoning entries `{effort, description}`. Custom-file initialization additionally requires nonempty `base_instructions` or `model_messages.instructions_template`. The scratch fixture uses a short owned coding template; parser success does not establish its behavioral equivalence. Do not blindly copy the documentation's large remote prompt. Set `supports_reasoning_summary_parameter: false` for this route.

## Offline behavioral evidence and remaining gate

Only the installed **Codex CLI 0.160.0** was verified. DeepSeek's catalog advertises `minimal_client_version: 0.144.0`; that is not proof that the entire integration works on that version. Use 0.160.0 as the validated release baseline and give older installations explicit setup guidance until separately verified.

Ignored local evidence under `.tmp/provider-fidelity-probe-home/`:

- `probe.ts`, `models.json`, `proof.json`: actual native `initialize` and `model/list` registered distinct Flash/Pro modalities. Initialization first failed without base instructions, then passed with the template.
- `openrouter-probe.ts`, `openrouter-proof.json`: dummy-key localhost fixture proved plain env auth made no discovery request; command auth actually invoked the helper, sent its dummy bearer token to `/api/v1/models`, and exposed returned image/reasoning metadata. An explicit catalog URL also requested the exact alternate path. This is stronger than a TOML parse that may ignore unknown keys.

No `turn/start`, real credentials, public model request, user-global configuration write or paid call was used. These probes do not certify connectivity or task behavior. Required closure remains: shared UI/HTTP/CLI native routing, missing-Codex guidance, per-run configuration isolation, secret non-persistence, modality/reasoning presentation and focused regression tests. Live representative code/tools, skills/MCP, image input/generation, interruption/resume and real-game acceptance still require their original evidence; pending human consent does not change the frozen scope.
