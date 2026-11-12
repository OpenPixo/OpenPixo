# Externally Prepared Workspaces

**Parent:** [`architecture.md`](architecture.md) · **Related:** [`plugins-spec.md`](plugins-spec.md) · [`agent-adapters.md`](agent-adapters.md)

OpenPixo supports OpenPixo-owned project storage and folder-backed projects. Folder-backed projects need explicit provenance so OpenPixo can tell apart user-selected local folders from disposable workspaces prepared by an external orchestrator.

The boundary is intentionally narrow: OpenPixo may read and write the workspace it is given, produce inspectable design outputs, and report enough provenance for callers to act on the result. Source checkout state, pull-request creation, deployment, publishing, and writeback policy remain outside OpenPixo unless a future feature deliberately owns that workflow.

## Contract

Workspace metadata separates storage from provenance:

- **Storage** answers where OpenPixo reads and writes files.
  - `pixo-owned`: OpenPixo-owned project files under the normal data/project directory.
  - `folder-backed`: files live at an external filesystem root.
- **Folder provenance** answers who prepared a folder-backed workspace and who owns follow-up actions.
  - `user-local`: a user-selected folder that OpenPixo edits in place.
  - `orchestrator-scratch`: a disposable folder prepared by an external orchestrator. OpenPixo may read and write the scratch workspace, but source authority and writeback stay outside OpenPixo.

This keeps OpenPixo local-first and integration-friendly without expanding its responsibility into source-control, deployment, or writeback policy.

## Metadata Shape

Callers should mark scratch workspaces declaratively on project metadata:

```json
{
  "baseDir": "/tmp/pixo-run-123/workspace",
  "importedFrom": "folder",
  "orchestratorWorkspace": {
    "kind": "scratch",
    "sourceLabel": "checkout:main",
    "sourceRef": "main@abc123",
    "baseRevision": "abc123",
    "writeback": "external"
  }
}
```

The `orchestratorWorkspace` fields are provenance, not authority. OpenPixo may surface them in run status, diagnostics, result manifests, and telemetry. It must not infer permission to mutate an external source from them.

## Git And Safety

OpenPixo should not maintain a broad git command firewall for externally prepared scratch workspaces. The orchestrator owns source checkout policy, credentials, remote configuration, branch selection, and writeback. OpenPixo should treat git state inside a scratch workspace as implementation detail unless a specific skill or artifact explicitly asks for a diff.

Local user folder imports have different provenance. When a user points OpenPixo directly at their own folder, OpenPixo is editing that folder in place. It is reasonable for OpenPixo to provide narrow UX warnings or preflight checks for that local mode, but those checks must not be framed as the sandbox boundary for externally prepared scratch workspaces.

## Result Boundary

The stable output boundary is a result package:

- run identity and terminal status;
- workspace storage and provenance supplied by the caller;
- project files and artifact manifests OpenPixo can enumerate;
- event-log location when configured;
- errors, exit code, signal, and cancellation state;
- optional diff or patch metadata when a future caller asks OpenPixo to compute it explicitly.

The package describes what OpenPixo produced. It does not apply the result to any source workspace.
