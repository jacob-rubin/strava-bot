---
status: authoritative
last-updated: 2026-09-10
---

← [Decisions](README.md) · [Index](../PLANNING.md)

# 0002 — Request `activity:write` only, no read scope

**Context.** Strava API Policy §5.3 prohibits using Strava data, directly or indirectly, in connection with developing, training, evaluating, or operating any AI application — explicitly including grounding, embeddings, and RAG. The LLM in this project generates titles/descriptions from workout data, so it would be easy to accidentally feed it a previous activity's stats "for better context."

**Decision.** Request only `activity:write` during the one-time OAuth authorization. No read scope is ever granted, so no Strava data can be fetched by this service at all — the constraint is enforced by what the token can do, not by a rule someone has to remember to follow in `llm.py`.

**Consequences.** All prompt content must derive from Strong's share text and this service's own Firestore `history` collection, never from Strava. This is checked further by an import-boundary test (`app.llm` must not import `app.strava`). See [Constraints #1–2](../CONSTRAINTS.md).

→ [Strava integration §7.2, §7.5](../planning/05-strava-integration.md)
