---
name: task-implementer
description: Execute one task runbook from docs/tasks in the strava-bot repo on its own branch, verify it, pause for review, then open a PR and update STATUS.md. Use when asked to implement, run, or pick up a task id (T04, T12, ...) or to do "the next task" / "the next one" / "pick up where we left off" in this repo — for those, scan docs/STATUS.md and run the earliest task not labeled done. Not for ad-hoc edits that are not covered by a runbook.
metadata:
  short-description: Run one strava-bot task runbook end to end
---

# Task implementer

Take exactly **one** runbook from `docs/tasks/` from selection through a pull request. One invocation = one task; stop after the PR is opened rather than starting the next one.

The pipeline is: select -> load spec -> branch -> claim -> implement -> verify -> **review gate (stop)** -> approve -> STATUS `done` + PR.

## 1. Select the task

"next task", "the next one", "pick up where we left off", or an invocation with no id at all all mean the same thing: resolve the task yourself from `docs/STATUS.md`. Do not ask the user which task to run — the table answers it.

**Selection algorithm**

1. Read the `## Tasks` table in `docs/STATUS.md`. That table is the only source of status: ignore git history, what happens to exist under `app/`, and any status-looking text inside a runbook.
2. Walk its rows top to bottom, which is ascending task id. Treat `done` and `skipped` as finished and pass over them.
3. The first row still standing is the candidate — the **earliest task not labeled `done`**. That is what "next task" resolves to.
4. Act on the candidate according to its status:
   - `not started` — run it, continuing from §2.
   - `in progress` — resume it instead of starting something new. If branch `codex/<task-id>-<slug>` already exists, check it out and keep working there, skipping §3 and §4 because the claim commit is already in place; restart from the earliest runbook step whose output is missing. If no such branch exists, treat the row as `not started`.
   - `blocked` — do not run it. Report what blocks it and which task clears it, name the earliest later row that is `not started` with all dependencies `done` as the alternative, and wait for the user to choose.
5. Before implementing, check the candidate's dependencies in `docs/tasks/README.md`. If any dependency is not `done`, or the runbook turns on an unresolved row in STATUS's **Open items** table, stop and report: which dependency or open item is missing, which task resolves it, and the earliest row whose dependencies are all satisfied. Do not silently substitute that row.

When the user names an id ("run T04", "do T12"), use exactly that task — but still apply step 5's dependency and open-item checks before starting.

Then state the selection in one line before moving on: chosen id and title, its status in `docs/STATUS.md`, and, when you auto-selected, which rows you skipped as finished.

## 2. Load the spec

Read, in this order:

- the runbook itself — its **Read first**, **Deliverable**, **Steps**, and **Done when** sections;
- every link under **Read first**; they are the spec and the runbook never restates them;
- `docs/CONSTRAINTS.md` in full whenever the task touches `app/`;
- any ADR under `docs/decisions/` covering the area, before questioning a choice that looks odd in isolation.

Runbooks are static spec: never edit one, and never record status inside one.

## 3. Create the task branch

Before the first file edit:

1. Confirm the working tree is clean (`git status --porcelain` is empty). If it is not, stop and report the dirty paths.
2. Fetch first, then sync `main`: `git fetch origin --prune`, `git switch main`, `git pull --ff-only`. The previous task's PR is usually merged between sessions, so a local `main` that was current last time is stale now — branching from it silently drops the dependency this task builds on.
3. Prove `main` is actually current before branching: `git rev-parse main origin/main` must print the same commit twice. If `main` cannot fast-forward, stop and report rather than merging or resetting it.
4. Create `codex/<task-id>-<runbook-slug>` from that synced `main` — the slug is the runbook filename without its id prefix and `.md`, so `docs/tasks/T05-config-module.md` gives `codex/T05-config-module`.

If that branch already exists locally or on `origin`, stop and ask which branch to use — unless you are resuming a row STATUS.md already marks `in progress` under §1 step 4, in which case that branch is the one to continue on. Bring it up to date with the `main` you just synced before writing any code: `git merge --ff-only main`, falling back to `git merge main` when the branch has diverged, so the resumed work sits on top of everything already merged. Stop and report if that merge conflicts. Never reset or force-update an existing branch. All work, including the STATUS edits, happens on this branch — never commit to `main`.

## 4. Claim the task

First commit on the branch: flip the task's row in `docs/STATUS.md` to `in progress`, update **Current focus** if this is now the active task, and bump that file's `last-updated`. Commit message: `<task-id>: claim`.

## 5. Implement

Build exactly what the runbook's **Deliverable** lists by following its **Steps**. Do not add modules, endpoints, or tests that belong to another task.

- A claim tagged `[U]` in the spec is unverified: probe it at runtime and fall back. Never make a required path depend on one.
- A claim tagged `[V]` can be relied on.
- If the spec itself turns out to be wrong, fix the spec in a **separate commit** rather than weakening a test or routing around `docs/CONSTRAINTS.md`.

## 6. Verify

Run the runbook's **Done when** block verbatim. Python commands go through the repo virtualenv (`.venv`, created by T04 — `.venv\Scripts\python.exe` on Windows), never the system interpreter, whose version differs from the spec's 3.12.

When the runbook has no automated check, verify end to end for real — start the service locally, issue the actual request, inspect the actual result — and capture the output. Never mark something verified from reading the code.

A failing check is not a reason to weaken the check. Fix the implementation, or stop and report if the spec and the check genuinely disagree.

For runbooks whose **Executor** is `human` or `agent + human step` (T01, T02, T06, T07, T20, T21), do the agent-side prep, then hand off using the format in [references/human-steps.md](references/human-steps.md) and wait. Resume verification from what the user pastes back.

## 7. Review gate — stop here

Commit the work on the branch, then **stop** and present:

- task id and title, and the branch name;
- files changed with a `git diff --stat` against `main`;
- the **Done when** command and its verbatim output;
- a constraint self-check: each rule in `docs/CONSTRAINTS.md` the change could plausibly touch, and how it is satisfied;
- any deviation from the spec, and any open item in `docs/STATUS.md` the work answers.

Until the user explicitly approves: do not push, do not open a PR, and do not flip STATUS to `done`. If the user asks for changes, amend on the same branch and return to the review gate.

## 8. On approval

1. Flip the task's row in `docs/STATUS.md` to `done`, adding a one-line note in the row if the work deviated from the spec.
2. Record any open item the work resolved inline in its row (e.g. "resolved — `POST /activities` accepts `sport_type` alone, 2026-09-XX") rather than deleting the row.
3. Update **Current focus** to the next task whose dependencies are all `done`, and bump `last-updated`.
4. Commit (`<task-id>: mark done`), push the branch, and open the PR:

```bash
gh pr create --base main --head codex/<task-id>-<slug> --title "<task-id> — <runbook title>" --body-file <summary>
```

The body carries the same summary shown at the review gate: what was built, the Done-when output, deviations, and resolved open items. Report the PR URL and stop. Do not merge, and do not start the next task.

## Guardrails

- Status lives only in `docs/STATUS.md` — never in a runbook, never inferred from git history.
- Never print, log, or commit a secret value or a `raw_text` payload. If a verification step would emit one, redact it before showing the output.
- Stay inside the selected task's **Deliverable**; note anything else you noticed rather than fixing it here.

## Keeping the installed copy in sync

This repo holds the source of truth. Codex discovers skills from `$CODEX_HOME/skills`, so after editing this skill, re-copy it:

```powershell
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
Copy-Item -Recurse -Force .codex/skills/task-implementer/* "$codexHome/skills/task-implementer/"
```

Two traps this form avoids, both of which fail silently:

- `$env:CODEX_HOME` is usually **unset** in an ordinary shell, so `"$env:CODEX_HOME/skills/..."` expands to `/skills/...` and writes a stray `C:\skills\` at the drive root while the real skill stays stale. Resolve the fallback to `~/.codex` first.
- Copying the **directory** onto a destination that already exists nests it (`task-implementer/task-implementer`) instead of updating it. Copy the directory's **contents** (`/*`) into the destination instead.

Then confirm the installed copy actually changed, rather than assuming the copy landed:

```powershell
Select-String -Path "$codexHome/skills/task-implementer/SKILL.md" -Pattern '<a phrase you just added>'
```
