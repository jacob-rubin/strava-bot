---
name: git-pr-handoff
description: Commit the completed, in-scope changes on the current branch, push them, open a GitHub pull request, and return its URL. Use only when the user explicitly asks to finalize a change as a pull request, not for preparing or reviewing a change.
---

# Git PR handoff

Finish a completed implementation as a pull request while preserving the user's intended scope.

The current user request must explicitly authorize committing, pushing, and opening a pull request. If it asks only to prepare, inspect, or suggest a PR, do those read-only steps and report what remains; do not mutate GitHub or Git state.

## Inspect first

Before writing anything, establish the branch, remotes, worktree status, staged and unstaged diffs, recent commits, upstream, and the repository's PR conventions. Check whether the current branch already has an open pull request. Follow repository-local contributor instructions, including required validation commands.

Do not proceed when HEAD is detached, the current branch is the default branch, GitHub authentication or the `gh` CLI is unavailable, or the target base branch is ambiguous. Ask the user for direction in those cases. Default the PR base to the repository's configured default branch only when the user did not name a base branch.

## Protect the change set

Commit only files that belong to the task being handed off. Use the diff to compare the actual changes with the requested outcome. Do not stage all changes wholesale; stage explicit in-scope paths. Stop and ask if there are unrelated modifications, unexpected generated files, merge conflicts, or possible credentials/secrets. Never include ignored files merely because they are present locally.

Run the repository's required checks and a whitespace-error check before committing. If a required check fails, report the failure and do not create the commit, push, or PR unless the user explicitly changes the scope of the request and repository rules allow proceeding.

## Commit, push, and create the PR

Choose a concise imperative commit subject grounded in the actual diff. Create one focused commit unless the user asked for a particular commit structure. Confirm the commit contains only the selected paths, then push the current branch to its normal remote, setting the upstream when needed.

If an open PR already exists for the branch, push the new commit(s), then update that PR rather than creating a duplicate. Read its current body and refresh the `## Summary` section from the full PR diff (base branch through the current HEAD), not only the latest commit. Keep the motivation, validation, and any human-authored sections intact unless they are now inaccurate. Replace only the Summary content; if no such section exists, add it at the top. Do not overwrite the full description merely to update the summary.

Otherwise create a non-draft PR with a concise, reviewer-oriented description. A good description is specific, skimmable, and supported by the task and verified diff; it explains both the outcome and the reason for it without restating implementation minutiae.

Use this structure, omitting a section only when no truthful content is available:

```markdown
## Summary

- [The user- or system-visible change.]
- [A second important change or constraint, if relevant.]

## Motivation

[The problem, opportunity, or purpose this PR addresses, and the intended benefit.]

## Validation

- `command` — passed
```

State the motivation in terms of the problem and intended benefit, rather than vague phrases such as "cleanup" or "updates." Do not invent product context, impact, metrics, or test results. When the motivation is self-evident, one direct sentence is enough.

Use `gh` for GitHub operations. Do not use `--fill` when it would produce a misleading title or body; write the PR metadata from the verified diff instead.

## Final response

Fetch the PR URL from GitHub after creation or reuse, then respond with the clickable URL. Include only a compact handoff summary: commit SHA, whether tests passed, and any material caveat. Do not claim the PR was opened until the URL lookup succeeds.
