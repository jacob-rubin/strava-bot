# Activity title and description

Implemented in [`app/activity_text.ts`](../../app/activity_text.ts). Formatting is local and deterministic: no provider, network call, prompt, credential, timeout, or fallback branch ([Constraint 9](../CONSTRAINTS.md)).

```typescript
export type ActivityText = { title: string; description: string };

export declare function formatActivityText(
  summary: WorkoutSummary,
  context: HistoryContext,
): ActivityText;
```

`WorkoutSummary` and `HistoryContext` are defined in [persistence](persistence.md#data-model-for-activity-text).

## Inputs

Service-owned data only: parsed exercises with per-set weight and reps, working-set/rep/volume totals, each exercise's top set, the workout name and start time, and the history context — previous best, days since last performed, volume trend, and PR flags.

## Output

The title is the workout name, trimmed, falling back to `Workout` when empty. The description opens with a workout-level line (exercise count, working sets, reps, total volume) and then one clause per exercise: name, top set, reps, volume, working-set count, followed — only when that exercise has history — by `PR`, its volume trend, and days since last performed.

Numbers are rendered plainly: no locale grouping, and no unit normalization.

## Constraints

- Title ≤ 60 characters. Description ≤ 1,000 characters. Both are truncated at the limit.
- Plain text. No markdown, emoji, or URLs.
- The description must reference specific numbers from the workout. A description that would read identically for a different workout is a failure.
- Never invent data. An exercise with no history contributes no comparative claim at all ([Constraint 10](../CONSTRAINTS.md)).
- PR and comparison claims come only from code-computed flags ([ADR 0005](../decisions/0005-pr-detection-in-code.md)). The formatter does no statistical inference and never compares values itself.
- Synchronous, local, and deterministic: identical inputs produce identical output.

AI-generated phrasing is deferred indefinitely. Any future design must keep this formatter as the complete default path and must comply with the [Strava data restriction](strava.md#policy-constraint).

The executable form of this section is [`tests/test_activity_text.ts`](../../tests/test_activity_text.ts).

---

← [Docs index](../README.md) · [Persistence](persistence.md) · [Input contract](input-contract.md)

