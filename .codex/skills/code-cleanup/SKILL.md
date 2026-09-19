---
name: code-cleanup
description: Clean up an exact named set of TypeScript files using this repository's style rules, without changing behavior. Use for targeted code normalization, not feature work or broad refactors.
---

# Code cleanup

Apply the rulebook in [references/style-rules.md](references/style-rules.md) to the exact files the parent names. The parent must provide at least one repository-relative TypeScript path. Do not select targets, broaden the file list, or edit a file another in-flight branch owns.

## Workflow

1. Fetch `origin --prune`. Confirm every target exists, is TypeScript, and is absent from the diff of every in-flight `origin/codex/*` branch. If any check fails, report it and stop.
2. Edit in place in the current checkout, on whatever branch it already has. Do not create a branch or a worktree, do not switch branches, and do not stage, commit, push, or open a pull request. If a target already carries uncommitted changes, say so before editing so the cleanup stays separable from work in progress.
3. Read the full rulebook. For source changes, read `docs/CONSTRAINTS.md`, the relevant planning section, and applicable ADRs before editing.
4. Discover the repository's formatter and linter commands. Run them only against the named files when their interfaces allow it; never run a repository-wide write command. If targeted automatic fixing is unavailable, run their check-only forms and make mechanical changes manually.
5. Apply only non-mechanical rules that are relevant to the named files. Do not change observable behavior, public statuses, dependency versions, tests, or specifications. The sole exception is the layout document required by R-005 after adding a module or test.
6. Run the applicable formatter/linter checks plus `npm run typecheck` and `npm test`. A failed check is a stop condition; do not weaken a check or make unrelated repairs.
7. Confirm the working-tree diff contains only named files and, when R-005 applies, `docs/planning/07-config-and-repo-layout.md`. Leave those changes uncommitted for the caller to review. If no worthwhile cleanup remains after tooling, revert the working tree to its prior state and report that instead.

## Decisions and stops

The precedence order is repository constraints, planning requirements, and ADRs; then this rulebook; then local preferences. A conflict, unclear invariant, ambiguous rule application, scope expansion, failed validation, or possible behavior change is a hard stop. Report the evidence and leave the affected code unmodified.

Do not create a cleanup ledger or a separate report file. The final report is the record, and the uncommitted diff is the deliverable. Include the rulebook commit SHA, checkout path, branch, validation output, changed files, each `file | rule ID | rationale`, and a separate ambiguity/stops section.
