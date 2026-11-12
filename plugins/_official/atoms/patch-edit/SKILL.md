---
name: patch-edit
description: Apply a project plan through small, reviewable file edits.
---

# Patch edit

Apply one planned change at a time and keep each diff within the step's
file ownership and intent. Use the smallest edit that completes the step.

## Inputs

- The current plan, including `plan/steps.json` when the workflow uses it.
- The user's requested change and the project's instructions.
- `code/index.json`, when available, for known imports and neighbouring files.

## Workflow

1. Read the current step and the affected files before editing.
2. Use the editing tools available in the session to modify project files.
3. Keep changes inside the step's scope. Revise the plan before expanding it.
4. Follow the project's authorization and validation requirements for shared
   infrastructure and other high-risk changes.
5. Update the plan with completed work, skipped steps with reasons, and blockers.

## Output

A reviewable project diff and updated plan. When the workflow uses on-disk
receipts, record each step's changed files, rationale, and completion state
under `plan/receipts/`.

## Completion

Every planned step is completed, explicitly skipped with a reason, or
reported as blocked. Run the relevant project checks before handing the
patch to review.
