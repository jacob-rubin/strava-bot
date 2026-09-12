---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T20 — Probe what Strong's share sheet delivers

|            |     |
| ---------- | --- |
| Phase      | [§13 step 4](../planning/10-build-order-and-client.md#13-build-order) — client |
| Depends on | — |
| Executor   | human |
| Blocked by | resolves [open item 1](../planning/11-open-items-and-sources.md#15-open-items) |

## Read first

- [§14 Client — iOS Shortcut](../planning/10-build-order-and-client.md#14-client--ios-shortcut) — the probe procedure and the fallback if only a URL arrives
- [Open item 1](../planning/11-open-items-and-sources.md#15-open-items) — this blocks the client choice in [T21](T21-shortcut-wiring-e2e.md)

## Deliverable

No repo change. A recorded answer to open item 1 in [STATUS.md](../STATUS.md).

## Steps

1. Create a share-sheet shortcut whose only action is `Quick Look` on Shortcut Input, per [§14](../planning/10-build-order-and-client.md#14-client--ios-shortcut).
2. Share a real workout from Strong into it and observe what arrives: the full text block, the `link.strong.app` URL alone, or both as separate items.
3. If only the URL arrives, [T21](T21-shortcut-wiring-e2e.md) uses the `Get Clipboard` fallback from [§14](../planning/10-build-order-and-client.md#14-client--ios-shortcut) instead of the share sheet. The server contract is unchanged either way.
4. While you have the workout open, share it a second time and compare slugs — that answers [open item 2](../planning/11-open-items-and-sources.md#15-open-items) for free.

## Done when

Observable: [STATUS.md](../STATUS.md) open-item row 1 reads `resolved` with the observed behaviour and date recorded inline, and row 2 is updated if the second share produced a comparison.

## On completion

Flip `T20` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

