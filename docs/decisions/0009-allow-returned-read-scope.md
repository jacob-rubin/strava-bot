---
status: authoritative
last-updated: 2026-09-14
---

← [Decisions](README.md) · [Index](../PLANNING.md)

# 0009 — Allow a returned `read` scope without using it

**Context.** [ADR 0002](0002-no-strava-read-scope.md) made the one-time authorization request only `activity:write` so the service would be structurally write-only. During [T06](../tasks/T06-authorize-script.md), Strava returned a grant of `read,activity:write` even though the authorize URL requested `activity:write`.

**Decision.** Accept that additional `read` scope. Do not reject or redo the authorization because `read` appears in the callback or token response. Keep the service write-only by never calling Strava read endpoints.

**Consequences.** The access token may carry broader permission than the service needs, but the code remains the enforcement point: no Strava read endpoint is called, and any future AI enhancement must still never receive Strava-originated data. This supersedes the "no read scope is ever granted" part of [ADR 0002](0002-no-strava-read-scope.md).

→ [Strava integration §7.2, §7.5](../planning/05-strava-integration.md) · [Constraint 2](../CONSTRAINTS.md)
