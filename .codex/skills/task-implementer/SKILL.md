---
name: task-implementer
description: Execute one task runbook from docs/tasks in the strava-bot repo in its own dedicated Git worktree and branch, verify it, pause for review, then open a PR, update STATUS.md, and remove the worktree after approval. Use when asked to implement, run, or pick up a task id (T04, T12, ...) or to do "the next task" / "the next one" / "pick up where we left off" in this repo — for those, scan docs/STATUS.md and run the earliest task not labeled done. Not for ad-hoc edits that are not covered by a runbook.
metadata:
  short-description: Run one strava-bot task runbook in an isolated worktree
---

# Task implementer

Take exactly **one** runbook from `docs/tasks/` from selection through a pull request. One invocation = one task; stop after the PR and worktree cleanup rather than starting the next one.

The pipeline is: fetch + select -> create/resume worktree -> load spec -> claim -> implement -> verify -> **review gate (stop)** -> approve -> STATUS `done` + PR -> remove worktree.

## 1. Select the task

"next task", "the next one", "pick up where we left off", or an invocation with no id at all all mean the same thing: resolve the task yourself from `docs/STATUS.md`. Do not ask the user which task to run — the table answers it.

Before selecting, resolve the primary repository root with `git rev-parse --show-toplevel` and run `git fetch origin --prune` from it. Do not switch its branch, edit it, or require it to be clean. Read the merged baseline from `origin/main` (for example, `git show origin/main:docs/STATUS.md`) so a stale or task-specific primary checkout cannot select from old status.

**Selection algorithm**

1. Read the `## Tasks` table in `docs/STATUS.md` from `origin/main`. That table is the only source of status: ignore git history, what happens to exist under `app/`, and any status-looking text inside a runbook.
2. Walk its rows top to bottom, which is ascending task id. Treat `done` and `skipped` as finished and pass over them.
3. The first row still standing is the candidate — the **earliest task not labeled `done`**. That is what "next task" resolves to.
4. Determine the candidate's effective status:
   - `not started` — run it, continuing from §2.
   - `in progress` — resume it instead of starting something new.
   - If the merged row says `not started` but local branch `codex/<task-id>-<slug>` exists and that branch's copy of `docs/STATUS.md` marks the row `in progress`, treat it as `in progress`. This is how an unpushed claim is resumed without relying on the primary checkout.
   - `blocked` — do not run it. Report what blocks it and which task clears it, name the earliest later row that is `not started` with all dependencies `done` as the alternative, and wait for the user to choose.
5. Check the candidate's dependencies in `docs/tasks/README.md` from the same ref used for its status. If any dependency is not `done`, or the runbook turns on an unresolved row in STATUS's **Open items** table, stop and report: which dependency or open item is missing, which task resolves it, and the earliest row whose dependencies are all satisfied. Do not silently substitute that row.

When the user names an id ("run T04", "do T12"), use exactly that task — but still apply step 5's dependency and open-item checks before starting.

Then state the selection in one line before moving on: chosen id and title, its effective status, and, when you auto-selected, which rows you skipped as finished.

## 2. Create or resume the task worktree

Derive the slug from the runbook filename without its id prefix and `.md`, so `docs/tasks/T05-config-module.md` gives slug `config-module`. Use:

- branch: `codex/<task-id>-<slug>`;
- worktree container: a sibling of the primary checkout named `<repo-name>-worktrees`;
- worktree path: `<worktree-container>/<task-id>-<slug>`.

For this repo, T05 therefore uses `../strava-bot-worktrees/T05-config-module`. Resolve and retain absolute paths for both the primary repository and task worktree. Run every later task command in the task worktree unless a step explicitly says to use the primary repository.

For a fresh task:

1. Confirm the expected path neither exists nor appears in `git worktree list --porcelain`. If it does, stop and report the collision; do not delete or reuse an unregistered directory.
2. Confirm the branch does not exist locally or on `origin`. If it does, stop and ask which branch to use; never reset or force-update it.
3. Create the sibling container if needed, then create the branch and worktree directly from the fetched baseline: `git worktree add -b codex/<task-id>-<slug> <absolute-worktree-path> origin/main`.

For an in-progress task:

1. Locate the branch in `git worktree list --porcelain`.
2. If it is already registered at the expected sibling path, resume there. Preserve and inspect any uncommitted task work; never discard it.
3. If it is registered anywhere else, including the primary checkout, stop and report that path. Do not move files or remove that worktree automatically.
4. If it is not registered, require the expected path to be absent, then attach the existing local branch with `git worktree add <absolute-worktree-path> codex/<task-id>-<slug>`. If there is no local branch, treat the task as fresh only when §1 found no valid in-progress claim.
5. Before editing a clean resumed branch, merge the fetched `origin/main`: try `git merge --ff-only origin/main`, then use `git merge origin/main` only when the branch has diverged. Stop and report merge conflicts. If the worktree already has uncommitted task work, inspect it and finish or commit it before bringing in `origin/main`.

Never use the primary checkout as the task worktree. All task edits and commits, including STATUS changes, happen in the dedicated worktree.

## 3. Load the spec

From the task worktree, read in this order:

- the runbook itself — its **Read first**, **Deliverable**, **Steps**, and **Done when** sections;
- every link under **Read first**; they are the spec and the runbook never restates them;
- `docs/CONSTRAINTS.md` in full whenever the task touches `app/`;
- any ADR under `docs/decisions/` covering the area, before questioning a choice that looks odd in isolation.

Runbooks are static spec: never edit one, and never record status inside one.

## 4. Claim the task

For a fresh task, the first commit in the task worktree flips the task's row in `docs/STATUS.md` to `in progress`, updates **Current focus** if this is now the active task, and bumps that file's `last-updated`. Commit message: `<task-id>: claim`.

An in-progress task with an existing claim commit skips this step.

## 5. Implement

Build exactly what the runbook's **Deliverable** lists by following its **Steps**. Do not add modules, endpoints, or tests that belong to another task.

- A claim tagged `[U]` in the spec is unverified: probe it at runtime and fall back. Never make a required path depend on one.
- A claim tagged `[V]` can be relied on.
- If the spec itself turns out to be wrong, fix the spec in a **separate commit** rather than weakening a test or routing around `docs/CONSTRAINTS.md`.

## 6. Verify

Run the runbook's **Done when** block verbatim in the task worktree. Install dependencies with `npm ci` when `node_modules/` is absent or stale, use the repo-local tools through npm scripts or `npm exec`, and verify that Node.js satisfies the `24.x` engine declared by T04. Do not install or invoke Python tooling for this project.

When the runbook has no automated check, verify end to end for real — start the service locally, issue the actual request, inspect the actual result — and capture the output. Never mark something verified from reading the code.

A failing check is not a reason to weaken the check. Fix the implementation, or stop and report if the spec and the check genuinely disagree.

For runbooks whose **Executor** is `human` or `agent + human step` (T01, T02, T06, T07, T20, T21), do the agent-side prep, then hand off using the format in [references/human-steps.md](references/human-steps.md) and wait. Resume verification from what the user pastes back.

## 7. Review gate — stop here

Commit the work in the task worktree, then **stop** and present:

- task id and title, branch name, and absolute worktree path;
- files changed with `git diff --stat origin/main...HEAD`;
- the **Done when** command and its verbatim output;
- a constraint self-check: each rule in `docs/CONSTRAINTS.md` the change could plausibly touch, and how it is satisfied;
- any deviation from the spec, and any open item in `docs/STATUS.md` the work answers.

Until the user explicitly approves: do not push, do not open a PR, do not flip STATUS to `done`, and do not remove the worktree. If the user asks for changes, amend them in the same worktree and return to the review gate.

## 8. On approval: finish, open the PR, and clean up

In the task worktree:

1. Flip the task's row in `docs/STATUS.md` to `done`, adding a one-line note in the row if the work deviated from the spec.
2. Record any open item the work resolved inline in its row (e.g. "resolved — `POST /activities` accepts `sport_type` alone, 2026-09-XX") rather than deleting the row.
3. Update **Current focus** to the next task whose dependencies are all `done`, and bump `last-updated`.
4. Commit (`<task-id>: mark done`) and push with `git push -u origin codex/<task-id>-<slug>`.
5. Open the PR:

```bash
gh pr create --base main --head codex/<task-id>-<slug> --title "<task-id> — <runbook title>" --body-file <summary>
```

The body carries the same summary shown at the review gate: what was built, the Done-when output, deviations, and resolved open items. Keep any temporary summary file outside the task worktree, or remove it before cleanup.

Only after `gh pr create` succeeds and returns the PR URL:

1. Confirm `git status --porcelain` in the task worktree is empty. If it is dirty, preserve the worktree and report the dirty paths with the PR URL.
2. Leave the task worktree before removing it. From the primary repository, run `git worktree remove <absolute-worktree-path>` without `--force`, then `git worktree prune`.
3. Verify the path no longer exists and no worktree entry points to it. If removal or verification fails, do not force-delete anything; report the PR URL, the absolute path, and the failure.
4. Preserve both the local branch and the pushed remote branch for PR follow-up.

Report the PR URL and whether cleanup succeeded, then stop. Do not merge, delete either branch, or start the next task.

## Guardrails

- Status lives only in `docs/STATUS.md` — never in a runbook, never inferred from commit history or file presence.
- The primary checkout is a control checkout only; its current branch and unrelated dirty files must remain untouched.
- Never force-remove a worktree, reset a task branch, or delete a colliding directory.
- Never print, log, or commit a secret value or a `raw_text` payload. If a verification step would emit one, redact it before showing the output.
- Stay inside the selected task's **Deliverable**; note anything else you noticed rather than fixing it here.
