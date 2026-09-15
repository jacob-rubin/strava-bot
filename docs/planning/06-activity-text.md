---
status: authoritative
last-updated: 2026-09-14
---

← [Index](../PLANNING.md)

## 8. Activity title and description formatting

The MVP formats activity text locally and deterministically. It has no AI provider, model API call, prompt, model credential, timeout, or model-specific fallback path.

**Interface:**

```typescript
export type ActivityText = { title: string; description: string };

export declare function formatActivityText(
  summary: WorkoutSummary,
  context: HistoryContext,
): ActivityText;
```

`WorkoutSummary` and `HistoryContext` are defined in [Persistence — Data model for activity text](04-persistence.md#data-model-for-activity-text).

**Inputs — service-owned data only.** Parsed exercises with per-set weight and reps, working-set/rep/volume totals, per-exercise top set, workout name and start time, plus [§6](04-persistence.md) history context: previous best for each exercise, days since last performed, volume trend.

**Constraints:**

- Title ≤ 60 chars. Description ≤ 1,000 chars.
- Plain text. No markdown, emoji, or URLs.
- The description must reference specific numbers from the workout. A description that would read identically for a different workout is a failure.
- Never invent data. If history context is empty, omit comparative claims entirely.
- PR and comparison claims come only from code-computed flags. The formatter does no statistical inference.
- Formatting is synchronous, local, and deterministic; identical inputs produce identical output.

AI-generated phrasing is a possible post-MVP enhancement, not an MVP dependency or task. Any future design must retain this deterministic formatter as the complete default path and comply with the Strava-data restriction in [§7.5](05-strava-integration.md#75-policy-constraint--non-negotiable).

---

← [Index](../PLANNING.md) · Previous: [Strava integration](05-strava-integration.md) · Next: [Configuration and repository layout](07-config-and-repo-layout.md)
