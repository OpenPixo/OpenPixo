---
name: build-test
description: Validate project changes with the project's build, typecheck, lint, and test commands.
---

# Build test

Validate the completed project edits with the checks declared by the
project. Record the commands and their results so the next editing or
review step can distinguish a passing check from an untested change.

## Inputs

- The project's instructions and declared validation commands.
- The completed edits and the affected project boundaries.
- Any build or test command explicitly supplied by the user.

## Workflow

1. Read the project's instructions and scripts before selecting checks.
2. Run the checks appropriate to the changed files after the edits are complete.
3. Record each command, exit status, and relevant failure output.
4. If a check is skipped, record the reason and leave its result unverified.

## Output

Summarize the checks that ran, their results, and any remaining failures.

## Completion

Every selected check has a recorded result or an explicit reason it could
not run. Resolve failures within the requested scope and report any that
remain; preserve the tests' intended assertions.
