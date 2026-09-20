---
status: authoritative
last-updated: 2026-09-15
---

← [Decisions](README.md) · [Docs index](../README.md)

# 0010 — Allow Strava read calls; keep the AI prohibition absolute

**Context.** [ADR 0002](0002-no-strava-read-scope.md) and [ADR 0009](0009-allow-returned-read-scope.md) kept the service structurally write-only: `read` may be granted, but no Strava read endpoint is ever called. A manual create then found that `POST /activities` can return `201` with a **zero-byte body** — reproduced on two consecutive creates on 2026-09-15, both of which created the activity correctly. Strava documents a `DetailedActivity` return, and its own guidance for a missing body is a read call (`GET /athlete/activities`). The write-only rule forbade that outright, leaving a manual probe no way to learn what it had just created except the web UI.

**Decision.** Permit Strava read endpoint calls anywhere they are useful — manual `curl`, probes, `scripts/`, and `app/` itself. The owner decided on 2026-09-15 not to carry a read prohibition in [Constraint 2](../CONSTRAINTS.md). What stays absolute is [Constraint 1](../CONSTRAINTS.md): the MVP has no AI component, and no Strava-originated data may ever reach one.

**Consequences.**

- **The structural guarantee is gone; the rule is now a plain rule.** [ADR 0002](0002-no-strava-read-scope.md) and [ADR 0009](0009-allow-returned-read-scope.md) made §5.3 compliance impossible to violate by accident: no read path existed, so no Strava data could reach an AI system even if one were added later. Compliance now rests on [Constraint 1](../CONSTRAINTS.md) alone. Anyone adding an AI component later ([deferred AI work](../README.md#known-unknowns)) must re-check every read call, because the barrier that used to make the question moot no longer exists.
- Strava API Policy §5.3 is still satisfied: it prohibits use of Strava data in connection with an **AI Application**, and strava-bot is not one. Reading data is not itself a violation.
- **The live §5.3 risk is the toolchain, not the service.** This repo is built with an AI coding agent, so a read response must not land in an agent context. Write Strava payloads to a gitignored file and quote only the minimum needed, such as the numeric activity id.
- `app/` may now read back the activity it just created, which is one way to recover the id when `POST /activities` answers `201` with an empty body. It is not the only way: the `Location` header is unprobed and needs no extra call, and the `id` is only used for a convenience link and a stored field, so dropping it is also viable.
- Supersedes the "never call any Strava read endpoint" conclusion of [ADR 0002](0002-no-strava-read-scope.md) and [ADR 0009](0009-allow-returned-read-scope.md). Their least-privilege reasoning is preserved only in that the authorization request still asks for `activity:write` and nothing more.

→ [Strava integration](../reference/strava.md) · [Constraint 2](../CONSTRAINTS.md)

← [Decisions](README.md) · [Docs index](../README.md)
