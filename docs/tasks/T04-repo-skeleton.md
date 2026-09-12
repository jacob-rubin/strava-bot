---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T04 — Scaffold the repository skeleton

|            |     |
| ---------- | --- |
| Phase      | [§13 step 1](../planning/10-build-order-and-client.md#13-build-order) — prove auth |
| Depends on | — |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§10 Repository layout](../planning/07-config-and-repo-layout.md#10-repository-layout) — the authoritative tree and dependency list
- [AGENTS.md](../../AGENTS.md)

## Deliverable

- `pyproject.toml` — Python 3.12, the dependencies named in [§10](../planning/07-config-and-repo-layout.md#10-repository-layout), and pytest configured
- Empty package directories `app/`, `scripts/`, `tests/`, `tests/fixtures/` matching [§10](../planning/07-config-and-repo-layout.md#10-repository-layout)
- `.gitignore` covering `__pycache__/`, `.venv/`, `.pytest_cache/`, and any local credential file

## Steps

1. Write `pyproject.toml` with exactly the runtime dependencies listed in [§10](../planning/07-config-and-repo-layout.md#10-repository-layout) and no ORM. Add `pytest` and `pytest-asyncio` as dev dependencies.
2. Create the directory tree from [§10](../planning/07-config-and-repo-layout.md#10-repository-layout). Create only the directories and `__init__.py` files; individual modules are created by their own tasks.
3. Create a virtual environment and install the project in editable mode.
4. Do **not** add `app/` modules here — each has its own task, and [CONSTRAINTS.md](../CONSTRAINTS.md) must be read before any of them.

## Done when

```bash
python -c "import sys; assert sys.version_info[:2] == (3, 12)"
pytest
```

`pytest` exits 0 collecting zero tests (`no tests ran`), and the tree matches [§10](../planning/07-config-and-repo-layout.md#10-repository-layout).

## On completion

Flip `T04` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

