---
status: authoritative
last-updated: 2026-09-14
---

← [Decisions](README.md) · [Docs index](../README.md)

# 0002 — Request `activity:write` only, no read scope

**Context.** The service only needs to create activities. Strava API Policy §5.3 also prohibits using Strava data, directly or indirectly, in connection with developing, training, evaluating, or operating any AI application — explicitly including grounding, embeddings, and RAG. The MVP has no AI integration, but least-privilege authorization should make unintended reads impossible now and under future changes.

**Decision.** Request only `activity:write` during the one-time OAuth authorization. No read scope is ever granted, so no Strava data can be fetched by this service at all.

**Consequences.** The service is structurally write-only. Any separately designed post-MVP AI enhancement would have to derive its input from Strong share text or this service's own data, never from Strava. See [Constraints #1–2](../CONSTRAINTS.md).

→ [Strava integration](../reference/strava.md)
