# Input contract — Strong share text

What `app/parser.ts` accepts. Line-oriented, UTF-8, exactly as Strong's share sheet produces it.

```
Early Morning Workout
Wednesday, September 9, 2026 at 6:43 AM

Deadlift (Barbell)
Set 1: 315 lb × 4
Set 2: 315 lb × 4
Set 3: 315 lb × 4

Hack Squat
Set 1: 160 lb × 9
Set 2: 160 lb × 9
Set 3: 160 lb × 9

Leg Extension (Machine)
Set 1: 145 lb × 11
Set 2: 145 lb × 11
Set 3: 145 lb × 11

Calf Press on Leg Press
Set 1: 205 lb × 11
Set 2: 205 lb × 11
Set 3: 205 lb × 11
https://link.strong.app/gvvdfvga
```

This block is the canonical fixture, kept verbatim at [`tests/fixtures/canonical.txt`](../../tests/fixtures/canonical.txt).

## Grammar

```
document      := title_line date_line block* share_link?
title_line    := <free text>                         # line 1
date_line     := "cccc, LLLL d, yyyy 'at' h:mm a"    # Luxon format; line 2, naive local time, no offset
block         := blank_line exercise_line set_line+
exercise_line := <free text, not matching /^Set \S+:/>
set_line      := "Set " index ": " payload
index         := digits | "W" | <other single token>
share_link    := "https://link.strong.app/" slug
```

## Parsing rules

1. **Line 1** is the workout name. **Line 2** is the start timestamp. Both are mandatory — a payload whose line 2 does not parse is rejected.
2. Blank lines are separators only; never significant.
3. A line matching `^Set\s+\S+:` is a set belonging to the most recent exercise line. A set line appearing before any exercise line records a line-numbered warning rather than failing, and the line content is not retained in the warning — warnings are logged, and [Constraint 7](../CONSTRAINTS.md) governs what may be logged.
4. Any other non-blank, non-link line starts a new exercise.
5. A line matching `^https?://link\.strong\.app/(?<slug>\S+)$` is the share link. The `slug` is captured and becomes part of the dedupe key.
6. **Strong uses U+00D7 MULTIPLICATION SIGN (`×`), not the letter `x`.** Regexes accept both, and a set line using either parses identically.
7. Exercise names carry optional trailing equipment in parentheses: `Deadlift (Barbell)` → base `Deadlift`, equipment `Barbell`. Absence of parentheses is normal (`Hack Squat`), as is a parenthesis-free name that merely contains a preposition (`Calf Press on Leg Press` keeps its full base name and a null equipment).
8. A set index beginning with `W` (case-insensitive) is a **warmup set**. Warmup sets are retained in the parsed structure and excluded from every total.
9. An unrecognized set payload is retained with `kind = "unparsed"` and its raw text. **Never drop a line** ([Constraint 5](../CONSTRAINTS.md)).

## Set payload variants

| Kind | Pattern | Example |
| --- | --- | --- |
| `weight_reps` | `<weight> <lb\|kg> × <reps>` | `315 lb × 4` |
| `assisted_reps` | `<+\|-><weight> <lb\|kg> × <reps>` | `+25 lb × 8`, `-40 lb × 10` |
| `reps` | `<reps> reps` | `12 reps` |
| `time` | `M:SS` or `H:MM:SS` | `1:30` |
| `distance` | `<dist> <mi\|km\|m\|ft>` | `1.5 mi` |
| `distance_time` | `<dist> <unit> in <time>` | `0.25 mi in 3:10` |
| `unparsed` | anything else | raw text retained |

A negative weight in `assisted_reps` means machine assistance; the sign is preserved. Each union variant nulls the measurements it does not carry — a `reps` set has `weight = null`.

## Terms

- **working set** — a non-warmup set; the only sets counted in volume, rep, and set totals.
- **warmup set** — a set whose index begins with `W`; retained, never counted.
- **top_set** — an exercise's working set with the greatest `(weight, reps)` lexicographically.
- **volume** — per set, `weight × reps`, and `0` when either is absent.
- **unparsed** — the retention kind for a payload the parser does not recognize.

## Derived values

- `volume` per set is `weight × reps`, `0` when either is absent. Units stay as the set logged them; **nothing is normalized** for display or activity text. Conversion to kilograms happens only in the structured-upload path ([strava](strava.md#structured-uploads)).
- `total_volume`, `total_reps`, and `total_sets` sum **working sets only**.
- `top_set` per exercise is the working set with the greatest `(weight, reps)` lexicographically.

## Duration

The share text carries a start time and **no end time**, while Strava requires `elapsed_time`:

```
elapsed = received_at - started_at        if 0 < delta <= ELAPSED_CAP_S (14400)
        = max(600, total_sets * 165)      otherwise
```

`received_at` is server receipt time converted to the workout's local wall clock. The four-hour cap stops a workout shared days later from becoming a multi-day activity.

**Timezone.** `date_line` is naive local time. A single fixed `LOCAL_TZ` (`America/Chicago`) is configured rather than inferred, and `start_date_local` is sent to Strava as the naive ISO-8601 string.

## Expected parser behaviour

The executable form of this section is [`tests/test_parser.ts`](../../tests/test_parser.ts) against the fixtures in [`tests/fixtures/`](../../tests/fixtures/). Against the canonical fixture above:

- 4 exercises; 12 working sets; 105 total reps; total volume 19,650 lb.
- `Deadlift (Barbell)` → base `Deadlift`, equipment `Barbell`, top set `315 lb × 4`, volume 3,780.
- `Hack Squat` and `Calf Press on Leg Press` → equipment `null`.
- `dedupe_key === "strong:gvvdfvga"`.
- `started_at === "2026-09-09T06:43:00"` (naive).

Across the variant fixtures:

- `Set W: 135 lb × 8` → `is_warmup=true`, excluded from all totals.
- `Set 1: 12 reps` → `kind="reps"`, `weight=null`.
- `Set 2: +25 lb × 8` → `weight=+25`; `Set 3: -40 lb × 10` → `weight=-40`.
- `Set 1: 1:30` → `duration_s=90`.
- `Set 1: 0.25 mi in 3:10` → `distance=0.25`, `distance_unit="mi"`, `duration_s=190`.
- `Set 2: something weird here` → `kind="unparsed"`, raw text retained, no exception.

If one of these expectations turns out to be wrong, correct it here deliberately rather than relaxing the test.

---

← [Docs index](../README.md) · [Persistence](persistence.md) · [Activity text](activity-text.md)

