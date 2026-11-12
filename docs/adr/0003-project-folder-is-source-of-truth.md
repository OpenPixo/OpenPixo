---
status: accepted
---

# Use the real game-project folder as the source of truth

OpenPixo will work directly with the game's actual project folder and manage the assets already belonging to that folder. A separate imported master library would require synchronization between development files and managed copies; direct project-folder ownership keeps the agent's code work, asset operations, and visual asset view grounded in the same files. Derived previews or indexes may support browsing but do not become a second authoritative asset collection. Exact metadata, indexing, and output policies remain implementation or follow-up scope decisions.
