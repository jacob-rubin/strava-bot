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

The title is the workout name, trimmed, falling back to `Workout` when empty. The name appears only in the title, not in the description.

The description is newline-separated lines. The first is a workout-level summary: exercise count and total volume only. Each exercise then gets its own line starting with `• ` (U+2022 and a space): name, load, and working sets, followed — only when that exercise has history — by `PR`, its volume trend, and days since last performed. Lines carry no trailing period.

- **Load** is the top set's weight and unit with no space (`315lb`), omitted when the exercise has no weighted set. When the working sets do not all share that weight and unit it reads `up to 315lb`, so a varied load is never stated as the weight of every set ([Constraint 10](../CONSTRAINTS.md)).
- **Working sets** reads `4 sets of 5 reps`, singular `set`/`rep` for a count of 1, and just `1 set` when no working set has reps (time, distance). The rep count is always the first working set's reps, even when later sets differ — a deliberate simplification chosen by the owner, since reps are usually constant per exercise; the per-set detail is in the structured upload Strava renders. Warmups are excluded; an exercise with no working sets shows only its name.
- There is no per-exercise volume; total volume appears only in the summary line.
- The description always ends with a blank line and then the fixed footer `Made with love by strava bot`.

```text
2 exercises, 7155 total volume
• Deadlift, 315lb, 4 sets of 5 reps
• Squat, up to 225lb, 3 sets of 8 reps

Made with love by strava bot
```

Numbers are rendered plainly: no locale grouping, and no unit normalization.

## Constraints

- Title ≤ 60 characters. Description ≤ 1,000 characters. Both are truncated at the limit; the description truncates the lines above the footer so the footer always survives.
- Plain text. No markdown, emoji, or URLs. The `•` bullet is a plain Unicode character, not markdown list syntax.
- The description must reference specific numbers from the workout. A description that would read identically for a different workout is a failure.
- Never invent data. An exercise with no history contributes no comparative claim at all ([Constraint 10](../CONSTRAINTS.md)).
- PR and comparison claims come only from code-computed flags ([ADR 0005](../decisions/0005-pr-detection-in-code.md)). The formatter does no statistical inference and never compares values itself.
- Synchronous, local, and deterministic: identical inputs produce identical output.

AI-generated phrasing is deferred indefinitely. Any future design must keep this formatter as the complete default path and must comply with the [Strava data restriction](strava.md#policy-constraint).

The executable form of this section is [`tests/test_activity_text.ts`](../../tests/test_activity_text.ts).

---

← [Docs index](../README.md) · [Persistence](persistence.md) · [Input contract](input-contract.md)

