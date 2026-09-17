---
status: authoritative
last-updated: 2026-09-16
---

← [Decisions](README.md) · [Index](../PLANNING.md)

# 0011 — Allow opt-out `raw_text` debug logging; keep the secret prohibition absolute

**Context.** [Constraint 7](../CONSTRAINTS.md) read "Never log `raw_text` or any secret," and [§11](../planning/08-error-handling.md) said the same. It bundled two unlike things under one prohibition. Logging a **secret** is unconditionally wrong: `INGEST_KEY`, `INGEST_PATH_TOKEN`, and the Strava refresh token are credentials, and [Constraint 3](../CONSTRAINTS.md) separately forbids logging supplied auth values. Logging **`raw_text`** is a privacy-and-retention tradeoff, not a correctness rule — and the data in question is the owner's own Strong share text in a single-user service ([Constraint 14](../CONSTRAINTS.md) puts multi-user out of scope).

The rule also made the service hard to debug. [T20](../tasks/T20-share-sheet-probe.md) established that the share sheet delivers full text, but the shape of that text across Strong versions and set formats is exactly what [open item 5](../planning/11-open-items-and-sources.md#15-open-items) tracks as unresolved. With `raw_text` barred from logs, the only way to see what actually arrived was to query Firestore after the fact, which is a poor loop while wiring the client in [T21](../tasks/T21-shortcut-wiring-e2e.md).

**Decision.** Split the rule. The owner decided on 2026-09-16 that `raw_text` may be logged, gated behind `DEBUG_LOG_RAW_TEXT`, which **defaults to `true`** for this deployment. Secrets remain absolutely unloggable, and [Constraint 3](../CONSTRAINTS.md) is untouched: an auth failure still emits only a counter, and a supplied key or path token is never written anywhere.

**Consequences.**

- `raw_text` now lands in Cloud Logging, which has a **30-day default retention** and is readable by any principal with `roles/logging.viewer` on the project. That is a second copy of the data outside Firestore, on a different lifecycle, with no deletion path tied to the Firestore doc. Set `DEBUG_LOG_RAW_TEXT=false` to stop it; shorten `_Default` bucket retention to narrow the window.
- This is **not** a Strava API Policy §5.3 question. `raw_text` is Strong share text supplied by the owner, never Strava-originated data, so no read payload is involved. [Constraint 1](../CONSTRAINTS.md) is unaffected and still absolute.
- **The toolchain caveat from [ADR 0010](0010-allow-development-read-calls.md) now applies to logs.** This repo is built with an AI coding agent, so tailing logs can pull workout text into an agent context. That is acceptable for the owner's own workout data, but it means log output is no longer automatically safe to paste. `tools/probe-auth.ps1` remains safe by construction — it prints status codes only.
- `raw_text` is still persisted to Firestore unconditionally. [Constraint 6](../CONSTRAINTS.md) is unchanged; logging is an addition, not a replacement, and [T27](../tasks/T27-reparse-script.md) still reads the durable copy rather than logs.
- Amends [Constraint 7](../CONSTRAINTS.md) and the logging paragraph of [§11](../planning/08-error-handling.md). The original wording is preserved here as the thing being changed.

→ [Error handling §11](../planning/08-error-handling.md) · [Constraint 7](../CONSTRAINTS.md)

← [Decisions](README.md) · [Index](../PLANNING.md)

