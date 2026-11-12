---
name: code-import
description: Inspect an existing project and record a reusable snapshot of its structure.
---

# Code import

Inspect the user-selected project before planning or editing it. Record
the relevant files, imports, and build configuration so later steps can
reuse the findings. Refresh the snapshot when its source files change.

## Inputs

- The project workspace selected by the user or supplied by the host.
- The requested change and any target runtime or stack requirements.

## Workflow

1. Read the project's instructions and identify the requested scope.
2. Inspect source files and declared dependencies within that scope.
3. Exclude generated output, dependency directories, and version-control internals.
4. Distinguish confirmed imports and runtime configuration from guesses.

## Output

Record a project snapshot in `code/index.json` when the workflow needs an
on-disk index. Include the relevant file paths, language and import
evidence, package scripts, and runtime or framework configuration.
Record exclusions and unresolved findings alongside the snapshot.

## Completion

The snapshot identifies the files and project commands needed for the
requested work. If the workspace is empty or unavailable, report that
condition before planning edits.
