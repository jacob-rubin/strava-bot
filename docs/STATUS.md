---
status: living-document
last-updated: 2026-09-11
---

← [Index](PLANNING.md)

# Build status

**Current focus:** build-order step 1 — write `scripts/authorize.py`, obtain a refresh token, and confirm a manual `curl` to `POST /activities`.

This tracks progress against the [build order](planning/10-build-order-and-client.md#13-build-order) and [open items](planning/11-open-items-and-sources.md#15-open-items). Unlike PLANNING.md, this file is expected to change on every work session — update it as steps complete instead of inferring progress from the code or git log.

## Build order

| # | Step | Status |
| - | ---- | ------ |
| 1 | `scripts/authorize.py`; obtain refresh token; manual `curl` to `POST /activities` | not started |
| 2 | Parser + tests against the §3 fixture | not started |
| 3 | `/ingest` with auth, size cap, parse, dedupe, Firestore, templated description; deploy | not started |
| 4 | Wire the iOS Shortcut; confirm round trip | not started |
| 5 | Replace template with LLM path + fallback | not started |
| 6 | `history` collection and PR flags | not started |
| 7 | Optional: probe `[U]` structured uploads | not started |

Nothing in `app/`, `scripts/`, or `tests/` exists yet — this repo currently holds only the spec in `docs/`.

## Open items

| # | Item | Status |
| - | ---- | ------ |
| 1 | Does the share sheet deliver full text or only the URL? | unresolved — resolve before step 3 (client choice depends on it) |
| 2 | Is the `link.strong.app` slug stable across shares? | unresolved — non-blocking, content-hash guard covers it either way |
| 3 | Does `POST /uploads` accept JSON; is the field `data_type` or `dataType`? | unresolved — only blocks step 7 |
| 4 | Does `POST /activities` require `type` alongside `sport_type`? | unresolved — non-blocking, spec says send both |
| 5 | Set-format coverage beyond the six known variants | ongoing — non-blocking, `unparsed` retains anything new |

## How to update this file

- Flip a build-order row to `in progress` / `done` as work happens; add a one-line note if a step deviated from the spec.
- Flip an open item to `resolved` and record the answer inline (e.g. "share sheet delivers full text — confirmed via Quick Look, 2026-09-XX") rather than deleting the row; [planning/11-open-items-and-sources.md](planning/11-open-items-and-sources.md)'s §15 stays the historical record of what was in question.
- Bump `last-updated` whenever this file changes.

---

← [Index](PLANNING.md)
