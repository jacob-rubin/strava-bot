---
status: authoritative
last-updated: 2026-09-13
---

← [Index](../PLANNING.md)

## 8. Title and description generation

**Interface.** One function, one provider-agnostic abstraction:

```typescript
export type GeneratedText = { title: string; description: string };

export declare function generate(
  summary: WorkoutSummary,
  context: HistoryContext,
): Promise<GeneratedText>;
```

`WorkoutSummary` and `HistoryContext` are defined in [Persistence — Data model for `generate()`](04-persistence.md#data-model-for-generate).

**Inputs — Strong-derived only.** Parsed exercises with per-set weight and reps, working-set/rep/volume totals, per-exercise top set, workout name and start time, plus [§6](04-persistence.md) `history` context: previous best for each exercise, days since last performed, volume trend.

**Constraints:**

- Title ≤ 60 chars. Description ≤ 1,000 chars.
- Plain text. No markdown, no emoji unless a config flag enables them, no URLs.
- The description must reference specific numbers from the workout. A description that would read identically for a different workout is a failure.
- Never invent data. If history context is empty, omit comparative claims entirely.
- Deterministic fallback required: on any LLM error or timeout (10s), emit a templated title and description from the parsed data and post anyway. **An LLM failure must never cost the user their activity.**

PR detection belongs in code, not the prompt: compare against `history` and pass explicit boolean flags. Models are unreliable at arithmetic comparisons and this is trivially computable.

Note the policy constraint from [§7.5](05-strava-integration.md#75-policy-constraint--non-negotiable): no Strava-originated data may reach this function or the model it calls.

---

← [Index](../PLANNING.md) · Previous: [Strava integration](05-strava-integration.md) · Next: [Configuration and repository layout](07-config-and-repo-layout.md)
