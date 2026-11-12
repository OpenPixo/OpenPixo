# OpenPixo

Language for a local, code- and skill-oriented development workbench serving independent game developers.

## Language

**Independent Game Developer (独立开发者)**:
A person or small team developing games independently, across both 2D and 3D projects.
_Avoid_: 2D-only developer

**Project (项目)**:
A game-development effort whose working code and assets belong to its actual project folder.
_Avoid_: Asset pack, separate imported library

**Workspace (工作区)**:
The local working environment in which a developer works with a Project and its development resources.
_Avoid_: Cloud drive, asset-only collection

**Game Asset (素材)**:
Digital content used in a game or its development, such as images, textures, sound, and models.
_Avoid_: Tool, generator

**Project Asset Management (项目素材管理)**:
Finding, previewing, and working with Game Assets in their actual Project folder.
_Avoid_: Asset marketplace, generation service, separate imported library

**Skill**:
A reusable set of instructions and procedures that guides a development agent through a kind of work.
_Avoid_: Model, asset, standalone generator

**MCP Integration (MCP 接入项)**:
An external tool or service made available to the development agent through a configured connection.
_Avoid_: Skill, asset generator

**Catalog (目录)**:
The collection of curated or user-imported Skills and MCP Integrations that a developer can add to the workbench. Entries are enabled for an individual Project by default.
_Avoid_: Asset store, model marketplace

**Asset Processing (素材处理)**:
Operations that transform existing Game Assets, including simple image or audio operations and batch work.
_Avoid_: Generation service

**Batch Operation (批量操作)**:
A single requested operation applied to multiple selected assets.
_Avoid_: Separate asset generator

**Agent Task (Agent 任务)**:
A unit of development work performed by an agent for a Project and associated conversation.
_Avoid_: Runtime vendor, conversation history

**Sub-agent Task (子代理任务)**:
An Agent Task delegated by another agent, with a relationship to its parent task.
_Avoid_: Another model provider, unrelated conversation

## Workbench terms

- **Project**: a workspace containing conversations, metadata and files. Imported games use the selected external folder.
- **Conversation**: a project-scoped sequence of user and assistant messages.
- **Run**: one physical agent execution, with events, approvals, results and analytics lineage.
- **Game asset**: an original project file, such as an image, audio clip, sprite sheet or engine resource.
- **Normal artifact**: an output with an entry file and artifact manifest. Its manifest identifies renderer, kind and exports.
- **Live artifact**: a refreshable output with source data and preview state, distinct from a normal artifact.
- **Active project**: the last project the user interacted with; MCP tools may use it when a project is omitted.
- **Project extension**: a project-enabled skill or MCP connection, with explicit source/version management.
- **Recipe**: a declared generation workflow with inputs, stages and artifacts, usable from UI and CLI.
- **Studio**: the media-generation surface, sharing daemon capabilities with the CLI.
- **Library**: the content-addressed asset registry; imported game files remain governed by their selected workspace.

Storage conventions are defined only by [AGENTS.md](../AGENTS.md#daemon-data-directory-contract). Runtime and prompt contracts live in [architecture](../architecture.md) and [prompt composition](../prompt-composition.md); source lineage belongs in [references](../references.md).
