---
status: authoritative
last-updated: 2026-09-20
---

← [Decisions](README.md) · [Docs index](../README.md)

# 0013 — Retire the task-runbook workflow and the status ledger

**Context.** The repository was built spec-first. A numbered implementation spec under `docs/planning/` was decomposed into 28 task runbooks under `docs/tasks/`, and progress was tracked in a ledger of one file per task and per open item under `docs/status/`, rendered into `docs/STATUS.md` by `tools/status.ts` and a GitHub Actions workflow, selected with `npm run status:next`, and executed by a `task-implementer` skill that claimed a task by pushing a `codex/<id>-*` branch. That machinery existed to let several agents build the same service in parallel without conflicting over a shared status file, and it worked: every task from T01 to T27 is merged, and T22 was deliberately skipped.

The build phase is over. Recent work is cleanups, fixes, and small behaviour changes — none of it covered by a runbook, and none of it contending for a task id. What remained was roughly 80 documentation files for a service of about 25 source modules, three overlapping descriptions of the same system, and a scheduler with nothing left to schedule.

**Decision.** Retire the whole apparatus:

- Delete `docs/planning/`, `docs/tasks/`, `docs/status/`, `docs/STATUS.md`, `docs/PLANNING.md`, `docs/glossary.md`, and `docs/post-mvp/`.
- Replace them with living documents that describe the system as it is: an index, an architecture map, an operations guide, and one reference document per concern, with the glossary terms inlined where each is defined.
- Delete `tools/status.ts`, the `status`, `status:write`, `status:check`, and `status:next` npm scripts, `.github/workflows/status.yml`, and the `task-implementer` skill.
- Keep `docs/CONSTRAINTS.md` with its rule numbering intact, and keep every ADR.

Future work is ordinary branches and pull requests.

**Consequences.**

- **Git history and merged PRs are the archive.** Per-task deviations, probe results, and open-item resolutions are not re-homed verbatim; whatever remained true about the system was folded into the reference documents, and the rest is recoverable from history.
- **Parallel agents lose their coordination mechanism.** Two agents editing the same file will now conflict like any other pair of contributors. That is an acceptable trade for a repository whose remaining work is small and sequential; a future build-out of comparable size would need a new ADR reinstating something like this, not a quiet revival of the deleted files.
- **Section numbers are gone as an addressing scheme.** Code comments that cited `§5` or `§6` now name the document they mean. A reference that outlives a rename is a path, not a number.
- **ADRs carry more weight.** With the planning spec deleted, the decision records are the only remaining account of *why*, which is exactly the role they were created for.
- **Two unresolved questions survive as prose**, in [the docs index](../README.md#known-unknowns), rather than as ledger files: share-slug stability and set-format coverage. Both are non-blocking and already mitigated in code.

→ [Docs index](../README.md) · [Decisions](README.md)

← [Decisions](README.md) · [Docs index](../README.md)

