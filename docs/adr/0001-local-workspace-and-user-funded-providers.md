---
status: superseded by ADR-0002
---

# Keep the workspace local and use developer-supplied provider access

Superseded after the user clarified the code- and skill-oriented in-app agent workbench. Local project ownership remains; asset-provider API adapters no longer define the product, and existing-agent access must be considered separately from direct provider API keys.

OpenPixo will keep the developer's workspace local and use the developer's own API keys for online capabilities, following the direction explicitly confirmed during product discovery. This prioritizes developer control and avoids making OpenPixo responsible for hosting project storage or funding users' inference as a prerequisite for the first release; a fully offline inference product was the alternative considered and is not required for the first release. Codex and Claude support is part of the intended experience, but agent authentication and integration routes remain separate, unresolved choices. Local project storage does not imply that prompts or assets never leave the device when the developer invokes an online provider.
