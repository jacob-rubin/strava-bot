---
name: cleanup-rules-update
description: Turn review feedback from a code-cleanup run into a precise update to its style rulebook. Use after reviewing a cleanup diff, not for application-code changes.
---

# Cleanup rules update

Use this skill in the main thread after the user provides feedback on a cleanup run. Change only `.codex/skills/code-cleanup/references/style-rules.md`; never change application code, tests, specifications, status files, or agent definitions.

## Before proposing a change

Read the feedback, cleanup branch or PR diff, `docs/CONSTRAINTS.md`, relevant planning material, ADRs, and the current rulebook. Classify each item as one of: missing durable rule, correctly stated rule misapplied, rule with an undesirable result, conflict/overlap with an existing rule, or one-off preference. State why a one-off will not be promoted.

For a durable change, locate the existing rule it belongs with. Amend or consolidate rather than append a duplicate. A rule must have a stable `R-###` ID, one-sentence rationale, short bad/good example when it clarifies application, and whether a linter can enforce it. Do not encode a linter-enforceable rule; recommend the relevant lint configuration instead.

## Approval and completion

Show the exact proposed patch, classifications, any non-promoted feedback, and applicable lint recommendation. Do not write until the user explicitly approves that patch.

After approval, apply the rulebook edit in place in the current checkout, on whatever branch it already has. Do not create a branch or a worktree, do not switch branches, and do not stage, commit, push, or open a pull request. Check for conflicting or duplicate rules and validate the skill, then leave the change uncommitted for the caller to review. Report the branch and the rulebook file path. If the approved rule would conflict with a constraint, planning requirement, ADR, or another rule, stop without editing.
