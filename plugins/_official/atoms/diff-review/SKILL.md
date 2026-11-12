---
name: diff-review
description: Review local project changes as a focused diff and report concrete findings, validation evidence, and unresolved issues.
---

# Diff review

Review local changes before handing off or continuing project work.

## Workflow

1. Establish the task's change boundary and the appropriate comparison
   baseline. Include relevant new files and distinguish existing work from
   the current task's edits.
2. Read the diff and affected interfaces. Check for correctness, data
   integrity, security, contract, and repository boundary problems.
3. Present concrete findings with severity, file locations, and the conditions
   that trigger each issue. Then summarize the changes and validation actually
   performed, including missing checks and known limitations.

## Completion

The report links to the reviewed diff or local files and accounts for every
finding. If no issues were found, say so and state what remains unverified.
Keep review separate from corrections; make edits only within the authorized
task scope.
