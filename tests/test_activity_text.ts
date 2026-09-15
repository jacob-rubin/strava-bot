import { describe, expect, it } from "vitest";

import { formatActivityText } from "../app/activity_text.js";

import type {
  ExerciseSummary,
  HistoryContext,
  TopSet,
  WeightRepsSet,
  WorkoutSummary,
} from "../app/models.js";

function weightSet(weight: number, reps: number, isWarmup = false): WeightRepsSet {
  return {
    kind: "weight_reps",
    index: isWarmup ? "W" : "1",
    is_warmup: isWarmup,
    volume: weight * reps,
    weight,
    unit: "lb",
    reps,
    duration_s: null,
    distance: null,
    distance_unit: null,
  };
}

function makeExercise(
  name: string,
  topSet: TopSet,
  totalVolume: number,
  totalReps: number,
  setCount = 1,
): ExerciseSummary {
  const sets: WeightRepsSet[] = Array.from(
    { length: setCount },
    () => weightSet(topSet.weight, topSet.reps),
  );

  return {
    name,
    equipment: "Barbell",
    top_set: topSet,
    total_volume: totalVolume,
    total_reps: totalReps,
    sets,
  };
}

const deadliftTop: TopSet = { weight: 315, unit: "lb", reps: 4 };
const squatTop: TopSet = { weight: 225, unit: "lb", reps: 5 };

function makeSummary(overrides: Partial<WorkoutSummary> = {}): WorkoutSummary {
  return {
    workout_name: "Early Morning Workout",
    started_at: "2026-09-09T06:43:00",
    total_volume: 7155,
    total_reps: 27,
    total_sets: 2,
    exercises: [
      makeExercise("Deadlift", deadliftTop, 3780, 12),
      makeExercise("Squat", squatTop, 3375, 15),
    ],
    ...overrides,
  };
}

function emptyContext(): HistoryContext {
  return { per_exercise: {}, pr_flags: {} };
}

describe("formatActivityText", () => {
  it("returns a plain title and description pair", () => {
    const result = formatActivityText(makeSummary(), emptyContext());

    expect(Object.keys(result).sort()).toStrictEqual(["description", "title"]);
    expect(result.title).toBe("Early Morning Workout");
    expect(result.description).toContain("Deadlift");
    expect(result.description).toContain("Squat");
  });

  it("keeps the title within 60 characters", () => {
    const longName = "W".repeat(80);
    const result = formatActivityText(
      makeSummary({ workout_name: longName }),
      emptyContext(),
    );

    expect(result.title).toHaveLength(60);
    expect(result.title).toBe("W".repeat(60));
  });

  it("keeps the description within 1,000 characters even for a long workout", () => {
    const exercises = Array.from({ length: 40 }, (_, index) =>
      makeExercise(
        `Exercise ${index}`,
        { weight: 100 + index, unit: "lb", reps: 10 },
        1_000 + index,
        10,
      ),
    );
    const result = formatActivityText(
      makeSummary({ exercises }),
      emptyContext(),
    );

    expect(result.description.length).toBeLessThanOrEqual(1_000);
    expect(result.description.length).toBe(1_000);
  });

  it("is deterministic for identical inputs", () => {
    const summary = makeSummary();
    const context = emptyContext();

    const first = formatActivityText(summary, context);
    const second = formatActivityText(
      structuredClone(summary),
      structuredClone(context),
    );

    expect(second).toStrictEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("produces different descriptions for two different workouts", () => {
    const other = makeSummary({
      total_volume: 2250,
      total_reps: 10,
      total_sets: 1,
      exercises: [
        makeExercise("Deadlift", { weight: 225, unit: "lb", reps: 5 }, 2250, 10),
      ],
    });

    expect(formatActivityText(other, emptyContext()).description)
      .not.toBe(formatActivityText(makeSummary(), emptyContext()).description);
  });

  it("omits comparative language when HistoryContext is empty", () => {
    const result = formatActivityText(makeSummary(), emptyContext());

    expect(result.description).not.toMatch(
      /\bPR\b|trend|days since|best|previous|compare|\bvs\b/i,
    );
  });

  it("uses only code-computed PR and trend flags when history is present", () => {
    const context: HistoryContext = {
      per_exercise: {
        Deadlift: {
          best_e1rm: 352.8,
          best_top_set: { weight: 305, unit: "lb", reps: 4 },
          days_since_last: 7,
          volume_trend: "up",
        },
      },
      pr_flags: { "Deadlift:weight": true },
    };
    const result = formatActivityText(makeSummary(), context);

    expect(result.description).toContain("PR");
    expect(result.description).toContain("volume trend up");
    expect(result.description).toContain("7 days since last");

    const squatLine = result.description
      .split(". ")
      .map((line) => line.trim())
      .find((line) => line.includes("Squat"));
    expect(squatLine).toBeDefined();
    expect(squatLine).not.toMatch(/\bPR\b|trend|days since|best|previous/i);
  });

  it("stays plain text with no markdown, emoji, or URLs", () => {
    const result = formatActivityText(makeSummary(), emptyContext());
    const output = `${result.title} ${result.description}`;

    expect(output).not.toMatch(/https?:|\bwww\./i);
    expect(output).not.toMatch(/[#*_[\]()`>]/);
    expect(output).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

