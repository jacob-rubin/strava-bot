---
name: code-cleanup
description: Clean up an exact named set of TypeScript files using this repository's style rules, without changing behavior. Use for targeted code normalization, not feature work or broad refactors.
---

# Code cleanup

Apply the rulebook in [references/style-rules.md](references/style-rules.md) to the exact files the parent names. The parent must provide at least one repository-relative TypeScript path. Do not select targets, broaden the file list, or edit a file another in-flight branch owns.

## Workflow

1. From the primary checkout, fetch `origin --prune`. Confirm every target exists, is TypeScript, and is absent from the diff of every in-flight `origin/codex/*` branch. If any check fails, report it and stop.
2. Create an isolated sibling worktree under `../strava-bot-worktrees/` from `origin/main` on a unique `codex/cleanup-<slug>` branch. Derive `<slug>` from the target set, check the branch and path do not already exist, and push the branch before editing. Do not use or modify the parent checkout.
3. In that worktree, read the full rulebook. For source changes, read `docs/CONSTRAINTS.md`, the relevant planning section, and applicable ADRs before editing.
4. Discover the repository's formatter and linter commands. Run them only against the named files when their interfaces allow it; never run a repository-wide write command. If targeted automatic fixing is unavailable, run their check-only forms and make mechanical changes manually.
5. Apply only non-mechanical rules that are relevant to the named files. Do not change observable behavior, public statuses, dependency versions, tests, or specifications. The sole exception is the layout document required by R-005 after adding a module or test.
6. Run the applicable formatter/linter checks plus `npm run typecheck` and `npm test`. A failed check is a stop condition; do not weaken a check or make unrelated repairs.
7. Confirm the diff contains only named files and, when R-005 applies, `docs/planning/07-config-and-repo-layout.md`. Commit, push, and open a PR. If no worthwhile cleanup remains after tooling, make no commit or PR.

## Decisions and stops

The precedence order is repository constraints, planning requirements, and ADRs; then this rulebook; then local preferences. A conflict, unclear invariant, ambiguous rule application, scope expansion, failed validation, or possible behavior change is a hard stop. Report the evidence and leave the affected code unmodified.

Do not create a cleanup ledger or a separate report file. The final report and PR are the record. Include the rulebook commit SHA, worktree path, branch, validation output, changed files, each `file | rule ID | rationale`, and a separate ambiguity/stops section.
