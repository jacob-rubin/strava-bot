---
status: authoritative
last-updated: 2026-09-14
---

← [Index](../PLANNING.md)

## 3. Input contract — Strong share text

Assume this exact format. Line-oriented, UTF-8.

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
https://link.strong.app/k3m8q2xz
```

### Grammar

```
document    := title_line date_line block* share_link?
title_line  := <free text>                       # line 1
date_line   := "cccc, LLLL d, yyyy 'at' h:mm a"    # Luxon format; line 2, naive local time, no offset
block       := blank_line exercise_line set_line+
exercise_line := <free text, not matching /^Set \S+:/>
set_line    := "Set " index ": " payload
index       := digits | "W" | <other single token>
share_link  := "https://link.strong.app/" slug
```

### Parsing rules

1. **Line 1** is the workout name. **Line 2** is the start timestamp. Both mandatory — reject the payload if line 2 fails to parse.
2. Blank lines are separators only; never significant.
3. A line matching `^Set\s+\S+:` is a set belonging to the most recent exercise line. A set line before any exercise line is a parse warning, not a failure.
4. Any other non-blank, non-link line starts a new exercise.
5. A line matching `^https?://link\.strong\.app/(?P<slug>\S+)$` is the share link. Capture `slug`.
6. **Strong uses U+00D7 MULTIPLICATION SIGN (`×`), not the letter `x`.** Regexes must accept both.
7. Exercise names carry optional trailing equipment in parentheses: `Deadlift (Barbell)` → base `Deadlift`, equipment `Barbell`. Absence of parentheses is normal (`Hack Squat`).
8. A set index beginning with `W` (case-insensitive) is a **warmup** set. Warmup sets are excluded from volume, rep, and set totals, but retained in the parsed structure.
9. An unrecognized set payload must be retained with `kind = "unparsed"` and its raw text. **Never drop a line.**

### Set payload variants

| Kind            | Pattern                            | Example                     |
| --------------- | ---------------------------------- | --------------------------- |
| `weight_reps`   | `<weight> <lb\|kg> × <reps>`       | `315 lb × 4`                |
| `assisted_reps` | `<+\|-><weight> <lb\|kg> × <reps>` | `+25 lb × 8`, `-40 lb × 10` |
| `reps`          | `<reps> reps`                      | `12 reps`                   |
| `time`          | `M:SS` or `H:MM:SS`                | `1:30`                      |
| `distance`      | `<dist> <mi\|km\|m\|ft>`           | `1.5 mi`                    |
| `distance_time` | `<dist> <unit> in <time>`          | `0.25 mi in 3:10`           |
| `unparsed`      | anything else                      | retain raw                  |

Negative weight in `assisted_reps` means machine assistance. Preserve the sign.

### Derived values

- `volume` per set = `weight × reps`, `0` when either is absent. Units are the set's own unit; **do not normalize** for display or activity-text formatting — Strava conversion happens only at [§7.4](05-strava-integration.md#74-creating-the-activity).
- `total_volume`, `total_reps`, `total_sets` sum **working sets only**.
- `top_set` per exercise = working set with the greatest `(weight, reps)` lexicographically.

### Duration

The share text has a start time and **no end time**. Strava requires `elapsed_time`.

```
elapsed = received_at - started_at        if 0 < delta <= 14400
        = max(600, total_sets * 165)      otherwise
```

`received_at` is server receipt time, converted to the workout's local wall clock. The 4-hour cap prevents sharing an old workout from creating a multi-day activity.

**Timezone:** `date_line` is naive local time. Configure a single fixed `LOCAL_TZ` (`America/Chicago`) rather than inferring one. Send `start_date_local` as the naive ISO-8601 string.

---

## 4. Parser module

`app/parser.ts` implements this section: §3's grammar, its nine parsing rules, and every set-payload variant, producing the structures in [§6](04-persistence.md#data-model-for-activity-text). It is built from this spec — there is no pre-existing implementation to port.

The normative definition of correct is [§12](09-acceptance-criteria.md#12-acceptance-criteria), whose parser and variant bullets cover warmup, bodyweight, assisted, timed, and distance payloads. If a §12 expectation turns out to be wrong, correct the spec deliberately rather than relaxing the test.

Build it via [T10](../tasks/T10-parser-core.md) and [T11](../tasks/T11-parser-derived-values.md).

---

← [Index](../PLANNING.md) · Previous: [Purpose and prerequisites](01-purpose-and-prerequisites.md) · Next: [Ingest API](03-ingest-api.md)
