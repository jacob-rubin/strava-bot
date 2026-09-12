---
status: authoritative
last-updated: 2026-09-10
---

← [Decisions](README.md) · [Index](../PLANNING.md)

# 0005 — PR detection computed in code, not left to the model

**Context.** The description generator wants to call out PRs ("heaviest deadlift set in 3 months"). This requires comparing the current workout's numbers against `history`. LLMs are unreliable at exact arithmetic comparisons, and a wrong PR claim is a visible, embarrassing failure mode in a public-facing activity description.

**Decision.** Compute PR/comparison flags (e.g. `is_weight_pr`, `is_volume_pr`) in code by comparing parsed values against the `history` collection, and pass them to the model as explicit booleans. The model is never asked to decide whether something is a PR.

**Consequences.** The model's job narrows to phrasing, which it's reliable at; the arithmetic that would embarrass the user if wrong lives in testable code instead of a prompt. See [Constraints #10](../CONSTRAINTS.md).

→ [Title and description generation §8](../planning/06-llm-generation.md)
