---
status: authoritative
last-updated: 2026-09-14
---

← [Decisions](README.md) · [Index](../PLANNING.md)

# 0005 — PR detection computed explicitly in code

**Context.** Activity descriptions may call out PRs ("heaviest deadlift set in 3 months"). This requires comparing the current workout's numbers against `history`, and a wrong claim is a visible failure in a public activity description.

**Decision.** Compute PR/comparison flags (e.g. `is_weight_pr`, `is_volume_pr`) in code by comparing parsed values against the `history` collection. The activity-text formatter consumes these explicit booleans and does not infer whether something is a PR.

**Consequences.** The comparison arithmetic lives in focused, testable code, and deterministic phrasing can only make claims the computed flags support. See [Constraints #10](../CONSTRAINTS.md).

→ [Activity title and description formatting §8](../planning/06-activity-text.md)
