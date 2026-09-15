---
status: authoritative
last-updated: 2026-09-15
---

← [Index](../PLANNING.md) · [Rendered status](../STATUS.md) · [Task runbooks](../tasks/README.md)

# Status ledger

Status is stored **one file per task** and **one file per open item**:

```
docs/status/
  tasks/T10.md        # status of one task, owned by that task's branch
  open-items/03.md    # status of one open item
```

[../STATUS.md](../STATUS.md) is a **rendered view** of these files, not the source of truth.

## Why

Several tasks run in parallel, each on its own branch and worktree. When every branch
edited the same table, the same `Current focus` paragraph, and the same `last-updated`
line in `docs/STATUS.md`, each merge after the first one conflicted — even when the two
branches were touching unrelated tasks, because the rows sit in one hunk.

One file per task removes the conflict by construction: a T10 branch only ever writes
`docs/status/tasks/T10.md`, so nothing it touches overlaps what a T14 branch touches.
Everything that used to be hand-maintained *across* rows — current focus, last-updated,
what is ready to start — is now derived at render time instead of being stored.

## Task file format

```markdown
---
id: T10
status: not started
updated: 2026-09-14
pr:
---

One-line note, shown in the Notes column. Optional; record deviations from the spec here.
```

- `status` — `not started` · `in progress` · `done` · `blocked` · `skipped`.
- `updated` — ISO date of the last status change. The newest date across all files becomes
  the rendered file's `last-updated`.
- `pr` — optional PR URL or `#number`, appended to the Notes column.
- The body is free text; keep it to a line or two.

Title, phase, executor, and dependencies are **not** stored here. They are static spec and
live in [../tasks/README.md](../tasks/README.md); the renderer joins the two.

## Open-item file format

```markdown
---
id: 3
item: Does `POST /uploads` accept JSON; is the field `data_type` or `dataType`?
status: unresolved
detail: blocks T26 only
resolved_by: T25
updated: 2026-09-14
---

The answer, once known, with the date it was established.
```

Flip `status` to `resolved` and write the answer in the body rather than deleting the file;
[../planning/11-open-items-and-sources.md](../planning/11-open-items-and-sources.md) stays the
historical record of what was in question.

## Commands

`node tools/status.ts` is dependency-free and runs on Node 24+ without `npm ci`.

| Command | What it does |
| ------- | ------------ |
| `npm run status` | Print the live picture: what is ready, what is claimed, what is waiting |
| `npm run status:next` | Same as above — this is what "work on the next item" resolves against |
| `npm run status:write` | Re-render [../STATUS.md](../STATUS.md) from this directory |
| `npm run status:check` | Exit non-zero if the rendered file is stale |

`status:next` reads the ledger from `origin/main` — the merged baseline — and treats any
`codex/<id>-*` branch, local or on `origin`, as a **claim** on that task. That is what keeps
two parallel agents from both picking the same "next" task: the claim is the pushed branch,
not a line in a shared file. Pass `--local` to read the ledger from the working tree instead,
which is what you want inside a task worktree.

## Rules

1. A task branch edits **only its own** ledger file. Never `docs/STATUS.md`, never another
   task's file. A diff that touches two ledger files is a merge conflict waiting to happen.
2. `docs/STATUS.md` is regenerated **on `main`** (by `.github/workflows/status.yml`, or by
   hand with `npm run status:write`). It is expected to be stale on a task branch; that is
   harmless, because nothing reads it to make a decision.
3. Claim a task by pushing its branch before doing the work. If the push is rejected because
   the branch already exists, someone else claimed it — pick another task rather than forcing.
4. A dependency counts as satisfied only when it is `done` **on `origin/main`**. A dependency
   that is merely in flight on someone else's branch does not unblock anything.

---

← [Index](../PLANNING.md) · [Rendered status](../STATUS.md) · [Task runbooks](../tasks/README.md)
