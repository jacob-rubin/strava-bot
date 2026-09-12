---
name: task-implementer
description: Execute one task runbook from docs/tasks in the strava-bot repo on its own branch, verify it, pause for review, then open a PR and update STATUS.md. Use when asked to implement, run, or pick up a task id (T04, T12, ...) or "the next task" in this repo. Not for ad-hoc edits that are not covered by a runbook.
metadata:
  short-description: Run one strava-bot task runbook end to end
---

# Task implementer

Take exactly **one** runbook from `docs/tasks/` from selection through a pull request. One invocation = one task; stop after the PR is opened rather than starting the next one.

The pipeline is: select -> load spec -> branch -> claim -> implement -> verify -> **review gate (stop)** -> approve -> STATUS `done` + PR.

## 1. Select the task

Use the task id the user names. Otherwise read `docs/STATUS.md` and take the first row that is not `done` whose dependencies (listed in `docs/tasks/README.md`) are all `done`.

Stop and report instead of proceeding when the chosen row is `blocked`, when any dependency is not `done`, or when an open item the runbook depends on is unresolved. Say which dependency is missing and which task resolves it.

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
2. Sync `main` (`git switch main`, `git pull --ff-only`).
3. Create `codex/<task-id>-<runbook-slug>` from `main` — the slug is the runbook filename without its id prefix and `.md`, so `docs/tasks/T05-config-module.md` gives `codex/T05-config-module`.

If that branch already exists locally or on `origin`, stop and ask which branch to use. Never reuse, reset, or force-update an existing branch. All work, including the STATUS edits, happens on this branch — never commit to `main`.

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
Copy-Item -Recurse -Force .codex/skills/task-implementer "$env:CODEX_HOME/skills/task-implementer"
```
