# OpenPixo data handling

OpenPixo is a local agent workbench. Game files stay in the imported workspace; daemon-owned configuration, conversations, credentials and runtime state follow [the daemon data directory contract](AGENTS.md#daemon-data-directory-contract). This document describes implementation boundaries, not a public hosted-service policy.

Agent and media-provider requests send the prompts, attachments and context needed for the selected task to the configured provider. Local execution does not imply offline model processing. External MCP servers, connectors and user-selected websites have their own data handling. Review their configuration before granting access.

Provider keys must stay out of argv, project source and persisted run records. Diagnostics can include logs and machine/runtime metadata; review exported bundles before sharing them. The repository has no public support email or issue destination configured.

Automatic-update and release-highlight sources are empty by default. Optional telemetry and explicit service configuration are described by the current source and acceptance record (openpixo-internal: `docs/coordination/STATUS.md`). Historical verification of an installed build does not establish the behavior of a new build.

For source lineage and component licenses see [references](docs/references.md), [NOTICE](NOTICE) and [LICENSE](LICENSE).
