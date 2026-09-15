---
name: task-implementer
description: Execute one task runbook from docs/tasks in the strava-bot repo in its own dedicated Git worktree and branch, verify it, pause for review, then open a PR and remove the worktree after approval. Use when asked to implement, run, or pick up a task id (T04, T12, ...) or to do "the next task" / "the next one" / "pick up where we left off" in this repo — for those, run `npm run status:next` and take its recommendation. Safe to run several at once. Not for ad-hoc edits that are not covered by a runbook.
metadata:
  short-description: Run one strava-bot task runbook in an isolated worktree
---

# Task implementer

Take exactly **one** runbook from `docs/tasks/` from selection through a pull request. One invocation = one task; stop after the PR and worktree cleanup rather than starting the next one.

The pipeline is: select -> create/resume worktree -> claim by pushing -> load spec -> implement -> verify -> **review gate (stop)** -> approve -> mark done + PR -> remove worktree.

**Assume you are not the only agent running.** Two mechanisms keep parallel tasks from colliding, and both are load-bearing:

- **The claim is the pushed branch** `codex/<task-id>-<slug>`, not a line in a shared file. Push it before doing any work.
- **Status is one file per task**: `docs/status/tasks/<task-id>.md`. Your branch edits *only its own*. `docs/STATUS.md` is generated from those files — never edit it, on any branch. [docs/status/README.md](../../../docs/status/README.md) has the format and the reasoning.

A merge conflict in this repo means a task branch wrote a file it does not own. Treat one as a bug in how the work was scoped, not as something to resolve by hand.

## 1. Select the task

"next task", "the next one", "pick up where we left off", or an invocation with no id at all all mean the same thing: resolve the task yourself. Do not ask the user which task to run.

From the primary repository root (`git rev-parse --show-toplevel`), without switching its branch, editing it, or requiring it to be clean:

```bash
git fetch origin --prune
npm run status:next
```

`status:next` reads the ledger from `origin/main` — the merged baseline, so a stale or task-specific checkout cannot mislead it — and folds in every `codex/<id>-*` branch, local or on `origin`, as a claim. Its `recommended:` line is the selection: the earliest task that is unfinished, unclaimed, executable by an agent, and whose dependencies are all `done` on `origin/main`. Do not read `docs/STATUS.md` to decide; it lags behind by design.

Take the recommendation unless one of these applies:

- **The user named an id.** Use exactly that task, but find it in the tool's output first. Listed under `claimed / in flight` — stop and report which branch holds it. Listed under `waiting on dependencies` — stop and report the missing dependency, which task delivers it, and the current recommendation as the alternative. Never silently substitute another task.
- **`recommended: none`.** Every ready task is already claimed. Report what is in flight and stop.
- **The recommendation skipped a human-only row** (`executor: human`, e.g. T07, T20). It was skipped because you cannot execute it. Name it in one line so the user can redirect you to it.
- **The candidate's ledger row is `blocked`.** Do not run it. Report what blocks it and the next unclaimed candidate, then wait.
- **The candidate turns on an unresolved open item.** Check `docs/status/open-items/` for any item the runbook depends on. If a blocking one is unresolved, stop and report it, which task resolves it, and the next candidate.

To resume: when the user says "pick up where we left off" and the tool lists a claimed branch, resume that branch per §2 instead of starting something new.

State the selection in one line before moving on: chosen id and title, its status, and anything you skipped and why.

## 2. Create or resume the task worktree

Derive the slug from the runbook filename without its id prefix and `.md`, so `docs/tasks/T05-config-module.md` gives slug `config-module`. Use:

- branch: `codex/<task-id>-<slug>`;
- worktree container: a sibling of the primary checkout named `<repo-name>-worktrees`;
- worktree path: `<worktree-container>/<task-id>-<slug>`.

For this repo, T05 therefore uses `../strava-bot-worktrees/T05-config-module`. Resolve and retain absolute paths for both the primary repository and the task worktree. Run every later task command in the task worktree unless a step explicitly says to use the primary repository.

For a fresh task:

1. Confirm the expected path neither exists nor appears in `git worktree list --porcelain`. If it does, stop and report the collision; do not delete or reuse an unregistered directory.
2. Confirm the branch does not exist locally or on `origin`. `status:next` already told you, but re-check — a parallel agent may have claimed it since.
3. Create the sibling container if needed, then create the branch and worktree directly from the fetched baseline: `git worktree add -b codex/<task-id>-<slug> <absolute-worktree-path> origin/main`.

For an in-progress task:

1. Locate the branch in `git worktree list --porcelain`.
2. If it is already registered at the expected sibling path, resume there. Preserve and inspect any uncommitted task work; never discard it.
3. If it is registered anywhere else, including the primary checkout, stop and report that path. Do not move files or remove that worktree automatically.
4. If it is not registered, require the expected path to be absent, then attach the branch with `git worktree add <absolute-worktree-path> codex/<task-id>-<slug>`, creating the local branch from `origin/codex/<task-id>-<slug>` when only the remote branch exists.
5. Before editing a clean resumed branch, merge the fetched baseline: try `git merge --ff-only origin/main`, then `git merge origin/main` only when the branch has diverged. If the worktree already has uncommitted task work, inspect it and finish or commit it first.

Never use the primary checkout as the task worktree. All task edits and commits happen in the dedicated worktree.

## 3. Claim it by pushing

Do this immediately after creating the worktree, before reading the spec — the window between selection and claim is the only place two agents can collide.

1. Edit exactly one file, `docs/status/tasks/<task-id>.md`: set `status: in progress` and `updated:` to today. Change nothing else.
2. Commit: `<task-id>: claim`.
3. Push at once: `git push -u origin codex/<task-id>-<slug>`.

If the push is **rejected** because the branch already exists on `origin`, another agent claimed the task inside that window. Do not force, reset, or reuse it. Remove your worktree (`git worktree remove <path>`), delete your local branch, re-run `npm run status:next`, take the new recommendation, and say in one line that you switched and why.

If the push fails for a network reason, say so and stop rather than working un-claimed — an unpushed claim is invisible to every other agent.

Do not touch `docs/STATUS.md`, a "current focus" line, or a `last-updated` stamp anywhere. All three are derived at render time.

A resumed branch that already has its claim commit skips this section.

## 4. Load the spec

From the task worktree, read in this order:

- the runbook itself — its **Read first**, **Deliverable**, **Steps**, and **Done when** sections;
- every link under **Read first**; they are the spec and the runbook never restates them;
- `docs/CONSTRAINTS.md` in full whenever the task touches `app/`;
- any ADR under `docs/decisions/` covering the area, before questioning a choice that looks odd in isolation.

Runbooks are static spec: never edit one, and never record status inside one.

## 5. Implement

Build exactly what the runbook's **Deliverable** lists by following its **Steps**. Do not add modules, endpoints, or tests that belong to another task — with tasks running in parallel, the file you are tempted to fix in passing is probably owned by an open branch. Note it instead; `npm run status` shows what is in flight.

- A claim tagged `[U]` in the spec is unverified: probe it at runtime and fall back. Never make a required path depend on one.
- A claim tagged `[V]` can be relied on.
- Touch a repo-wide file (`package.json`, `tsconfig.json`, `terraform/`) only when your runbook calls for it, and keep the edit additive and minimal.
- Never edit another task's ledger file.
- If the spec itself turns out to be wrong, fix the spec in a **separate commit** rather than weakening a test or routing around `docs/CONSTRAINTS.md`.

## 6. Verify

Run the runbook's **Done when** block verbatim in the task worktree. Install dependencies with `npm ci` when `node_modules/` is absent or stale, use the repo-local tools through npm scripts or `npm exec`, and verify that Node.js satisfies the `24.x` engine declared by T04. Do not install or invoke Python tooling for this project.

When the runbook has no automated check, verify end to end for real — start the service locally, issue the actual request, inspect the actual result — and capture the output. Never mark something verified from reading the code.

A failing check is not a reason to weaken the check. Fix the implementation, or stop and report if the spec and the check genuinely disagree.

For runbooks whose **Executor** is `human` or `agent + human step` (T01, T02, T06, T07, T20, T21), do the agent-side prep, then hand off using the format in [references/human-steps.md](references/human-steps.md) and wait. Resume verification from what the user pastes back.

## 7. Review gate — stop here

Commit the work in the task worktree. Pushing work commits to your own claimed branch is fine and keeps the claim honest. Then **stop** and present:

- task id and title, branch name, and absolute worktree path;
- files changed with `git diff --stat origin/main...HEAD`;
- the **Done when** command and its verbatim output;
- a constraint self-check: each rule in `docs/CONSTRAINTS.md` the change could plausibly touch, and how it is satisfied;
- confirmation that the only status file in the diff is `docs/status/tasks/<task-id>.md` — plus any open-item file the work genuinely resolves — and that `docs/STATUS.md` is untouched;
- any deviation from the spec, and any open item the work answers.

Until the user explicitly approves: do not open a PR, do not flip the ledger to `done`, and do not remove the worktree. If the user asks for changes, amend them in the same worktree and return to the review gate.

## 8. On approval: finish, open the PR, and clean up

In the task worktree:

1. `git fetch origin --prune`, then `git merge --ff-only origin/main`, falling back to `git merge origin/main` if the branch diverged — other tasks have been merging while you worked. A conflict here means the branch wrote a file another task owns: stop and report it rather than resolving it by hand. The one exception is `docs/STATUS.md`, which is generated — take main's copy with `git checkout origin/main -- docs/STATUS.md` and never re-render it on a task branch.
2. In `docs/status/tasks/<task-id>.md`, set `status: done`, bump `updated:`, and put any deviation from the spec in the body as one line. Fill `pr:` only if you already know the URL; it is optional.
3. If the work resolved an open item, edit that item's file in `docs/status/open-items/` — `status: resolved` plus the answer and the date in the body. Leave the file in place, and leave the question itself in \u00a715 of `docs/planning/11-open-items-and-sources.md`, which is where it is defined.
4. Commit (`<task-id>: mark done`) and push.
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

Report the PR URL and whether cleanup succeeded, then stop. Do not merge, delete either branch, or start the next task. `docs/STATUS.md` re-renders itself on `main` once the PR merges (`.github/workflows/status.yml`, or `npm run status:write` on `main` by hand).

## Guardrails

- Status lives in `docs/status/`, one file per task. `docs/STATUS.md` is generated: never hand-edit it, never commit a re-render from a task branch, never read it to decide what to work on.
- A task branch's diff contains exactly one file under `docs/status/tasks/`, and touches an open-item file only when the task actually resolved that item.
- The claim is the pushed branch. Never force-push, reset, rebase, or delete a branch you did not create in this run, and never take over another agent's worktree.
- The primary checkout is a control checkout only; its current branch and unrelated dirty files must remain untouched.
- Never force-remove a worktree or delete a colliding directory.
- Never print, log, or commit a secret value or a `raw_text` payload. If a verification step would emit one, redact it before showing the output.
- Stay inside the selected task's **Deliverable**; note anything else you noticed rather than fixing it here.
