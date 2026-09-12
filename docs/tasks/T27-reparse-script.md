---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T27 — Write `scripts/reparse.py`

|            |     |
| ---------- | --- |
| Phase      | [§13 step 7](../planning/10-build-order-and-client.md#13-build-order) — optional tooling |
| Depends on | [T11](T11-parser-derived-values.md), [T13](T13-store-workouts.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§10 Repository layout](../planning/07-config-and-repo-layout.md#10-repository-layout) — this script's stated purpose
- [§6 Persistence](../planning/04-persistence.md#6-persistence) — `raw_text` is retained precisely to make this possible
- [Constraint 6](../CONSTRAINTS.md)
- [Open item 5](../planning/11-open-items-and-sources.md#15-open-items) — the ongoing set-format coverage item this script services

## Deliverable

- `scripts/reparse.py` — re-parses stored `raw_text` after a parser change and reports differences

## Steps

1. Read every `workouts` document, re-run the current parser over `raw_text`, and diff against the stored `parsed` map.
2. Default to a dry run that only reports; require an explicit flag to write updated `parsed` values back.
3. Never re-post to Strava and never touch `strava`, `status`, or `history` fields — this is a parsing backfill, not a replay.
4. Report a count of sets whose `kind` changed away from `unparsed`; that number is the measure of progress on [open item 5](../planning/11-open-items-and-sources.md#15-open-items).

## Done when

```bash
python scripts/reparse.py --dry-run
```

Exits 0 reporting per-document diffs and an `unparsed` count, with no writes performed and no Strava call made.

## On completion

Flip `T27` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

