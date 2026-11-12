---
name: rewrite-plan
description: Plan a multi-file project change with explicit file ownership, scope, and validation steps.
---

# Rewrite plan

Plan a multi-file project change before editing. Give each step a clear
purpose, owned files, and validation criteria so later editing and review
can follow the same scope.

## Inputs

- The user's requested change and the project's instructions.
- `code/index.json` from `code-import`, when available.
- The affected source files, their dependencies, and existing project checks.

## Workflow

1. Inspect the affected files and record the intended result.
2. Divide the work into bounded steps with explicit owned files and rationale.
3. Classify file ownership and record the risk of shared changes.
4. Include the relevant `build-test` checks and a final `diff-review` step.

## Output

Use these files when the workflow needs an on-disk plan:

- `plan/plan.md`: the intended result and approach.
- `plan/ownership.json`: local files and shared infrastructure boundaries.
- `plan/steps.json`: ordered steps with owned files, rationale, risk, and checks.

`steps.json` supplies the work for `patch-edit`. Apply the project's
authorization and validation requirements to each step's risk.

## Completion

Every requested change has a bounded step, and every step identifies its
owned files and how completion will be checked. Record unresolved inputs
before beginning dependent edits.
