---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T21 — Wire the Shortcut and confirm the round trip

|            |     |
| ---------- | --- |
| Phase      | [§13 step 4](../planning/10-build-order-and-client.md#13-build-order) — client |
| Depends on | [T19](T19-cloud-run-deploy.md), [T20](T20-share-sheet-probe.md) |
| Executor   | human |
| Blocked by | [open item 1](../planning/11-open-items-and-sources.md#15-open-items) must be resolved first |

## Read first

- [§14 Client — iOS Shortcut](../planning/10-build-order-and-client.md#14-client--ios-shortcut) — the two-action shortcut and the operational notes
- [§12 End-to-end](../planning/09-acceptance-criteria.md#12-acceptance-criteria) — the manual acceptance bullet

## Deliverable

No repo change. A working "Post to Strava" shortcut and one real activity created end to end.

## Steps

1. Build the shortcut exactly as [§14](../planning/10-build-order-and-client.md#14-client--ios-shortcut) specifies — two actions, raw Shortcut Input as the body, no parsing or branching on the client. Use the `Get Clipboard` variant if [T20](T20-share-sheet-probe.md) found the share sheet delivers only a URL.
2. Point it at the [T19](T19-cloud-run-deploy.md) service URL with the `path_token` path segment and the `X-Ingest-Key` header.
3. Share a real Strong workout and read the notification body — it is the plain-text line from the [§5](../planning/03-ingest-api.md#5-ingest-api) response table.
4. Share the same workout again and confirm the response begins `already posted:` with no second activity.
5. Note the operational caveats in [§14](../planning/10-build-order-and-client.md#14-client--ios-shortcut): the key is plaintext in the shortcut and syncs via iCloud — never share the shortcut.

## Done when

Observable: the activity appears on Strava with a title and a description containing real numbers from that workout ([§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria) end-to-end bullet), and a repeat share returns `already posted:` without creating a duplicate.

## On completion

Flip `T21` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

