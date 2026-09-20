import { readFileSync } from "node:fs";

import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  ActivityText,
  AssistedRepsSet,
  DistanceSet,
  DistanceTimeSet,
  Exercise,
  ExerciseHistory,
  ExerciseSummary,
  HistoryContext,
  RepsSet,
  SetKind,
  TimeSet,
  TopSet,
  UnparsedSet,
  WeightRepsSet,
  Workout,
  WorkoutSet,
  WorkoutSummary,
} from "../app/models.js";

const weightReps: WeightRepsSet = {
  kind: "weight_reps",
  index: "1",
  is_warmup: false,
  volume: 1260,
  weight: 315,
  unit: "lb",
  reps: 4,
  duration_s: null,
  distance: null,
  distance_unit: null,
};

const warmup: WeightRepsSet = {
  kind: "weight_reps",
  index: "W",
  is_warmup: true,
  volume: 1080,
  weight: 135,
  unit: "lb",
  reps: 8,
  duration_s: null,
  distance: null,
  distance_unit: null,
};

const assisted: AssistedRepsSet = {
  kind: "assisted_reps",
  index: "3",
  is_warmup: false,
  volume: -400,
  weight: -40,
  unit: "lb",
  reps: 10,
  duration_s: null,
  distance: null,
  distance_unit: null,
};

const bodyweight: RepsSet = {
  kind: "reps",
  index: "1",
  is_warmup: false,
  volume: 0,
  weight: null,
  unit: null,
  reps: 12,
  duration_s: null,
  distance: null,
  distance_unit: null,
};

const timed: TimeSet = {
  kind: "time",
  index: "1",
  is_warmup: false,
  volume: 0,
  weight: null,
  unit: null,
  reps: null,
  duration_s: 90,
  distance: null,
  distance_unit: null,
};

const distance: DistanceSet = {
  kind: "distance",
  index: "1",
  is_warmup: false,
  volume: 0,
  weight: null,
  unit: null,
  reps: null,
  duration_s: null,
  distance: 1.5,
  distance_unit: "mi",
};

const distanceTime: DistanceTimeSet = {
  kind: "distance_time",
  index: "1",
  is_warmup: false,
  volume: 0,
  weight: null,
  unit: null,
  reps: null,
  duration_s: 190,
  distance: 0.25,
  distance_unit: "mi",
};

const unparsed: UnparsedSet = {
  kind: "unparsed",
  index: "2",
  is_warmup: false,
  volume: 0,
  raw: "something weird here",
  weight: null,
  unit: null,
  reps: null,
  duration_s: null,
  distance: null,
  distance_unit: null,
};

const everyVariant: WorkoutSet[] = [
  weightReps,
  assisted,
  bodyweight,
  timed,
  distance,
  distanceTime,
  unparsed,
];

/**
 * Narrowing by "kind" alone is what makes WorkoutSet a usable discriminated
 * union: each branch below reaches only the fields its variant actually
 * carries, and the "never" default stops compiling the moment a variant is
 * added without a branch here.
 */
function describeSet(set: WorkoutSet): string {
  switch (set.kind) {
    case "weight_reps":
      return set.weight + " " + set.unit + " x " + set.reps;
    case "assisted_reps":
      return (set.weight > 0 ? "+" : "") + set.weight + " " + set.unit +
        " x " + set.reps;
    case "reps":
      return set.reps + " reps";
    case "time":
      return set.duration_s + "s";
    case "distance":
      return set.distance + " " + set.distance_unit;
    case "distance_time":
      return set.distance + " " + set.distance_unit + " in " +
        set.duration_s + "s";
    case "unparsed":
      return set.raw;
    default: {
      const exhaustive: never = set;
      return exhaustive;
    }
  }
}

describe("WorkoutSet", () => {
  it("discriminates all seven payload variants by kind", () => {
    expect(everyVariant.map((set) => set.kind)).toStrictEqual([
      "weight_reps",
      "assisted_reps",
      "reps",
      "time",
      "distance",
      "distance_time",
      "unparsed",
    ] satisfies SetKind[]);
  });

  it("narrows to variant-only fields through the kind discriminant", () => {
    expect(everyVariant.map(describeSet)).toStrictEqual([
      "315 lb x 4",
      "-40 lb x 10",
      "12 reps",
      "90s",
      "1.5 mi",
      "0.25 mi in 190s",
      "something weird here",
    ]);
  });

  it("nulls the measurements a variant does not carry", () => {
    expect(bodyweight.weight).toBeNull();
    expect(bodyweight.unit).toBeNull();
    expect(timed.reps).toBeNull();
    expect(timed.weight).toBeNull();
    expect(distance.duration_s).toBeNull();
    expect(unparsed.weight).toBeNull();
    expect(unparsed.reps).toBeNull();
    expect(unparsed.duration_s).toBeNull();
    expect(unparsed.distance).toBeNull();
    expect(unparsed.distance_unit).toBeNull();
  });

  it("keeps an unrecognized payload as a first-class kind with its raw text", () => {
    expect(unparsed.kind).toBe("unparsed");
    expect(unparsed.raw).toBe("something weird here");
    expectTypeOf<UnparsedSet["raw"]>().toEqualTypeOf<string>();
  });

  it("preserves the sign of an assisted set and zeroes volume without weight", () => {
    expect(assisted.weight).toBe(-40);
    expect(bodyweight.volume).toBe(0);
    expect(timed.volume).toBe(0);
    expect(weightReps.volume).toBe(315 * 4);
  });

  it("flags warmups without removing them from the structure", () => {
    expect(warmup.is_warmup).toBe(true);
    expect(weightReps.is_warmup).toBe(false);
    expect(warmup.index).toBe("W");
    expectTypeOf<WorkoutSet["is_warmup"]>().toEqualTypeOf<boolean>();
    expectTypeOf<WorkoutSet["index"]>().toEqualTypeOf<string>();
  });

  it("types units as the documented literal unions", () => {
    expectTypeOf<WeightRepsSet["unit"]>().toEqualTypeOf<"lb" | "kg">();
    expectTypeOf<DistanceSet["distance_unit"]>().toEqualTypeOf<
      "mi" | "km" | "m" | "ft"
    >();
  });
});

describe("Workout", () => {
  const exercise: Exercise = {
    name: "Deadlift",
    equipment: "Barbell",
    sets: [warmup, weightReps],
  };

  const workout: Workout = {
    workout_name: "Early Morning Workout",
    started_at: "2026-09-09T06:43:00",
    exercises: [exercise, { name: "Hack Squat", equipment: null, sets: [] }],
    share_slug: "k3m8q2xz",
    warnings: [],
  };

  it("splits the exercise name from its optional equipment", () => {
    expect(exercise.name).toBe("Deadlift");
    expect(exercise.equipment).toBe("Barbell");
    expect(workout.exercises[1]?.equipment).toBeNull();
    expectTypeOf<Exercise["equipment"]>().toEqualTypeOf<string | null>();
  });

  it("retains warmup and working sets together in document order", () => {
    expect(exercise.sets.map((set) => set.index)).toStrictEqual(["W", "1"]);
  });

  it("carries a naive start timestamp and a nullable share slug", () => {
    expect(workout.started_at).toBe("2026-09-09T06:43:00");
    expect(workout.started_at).not.toMatch(/[Zz]|[+-]\d{2}:\d{2}$/);
    expect(workout.share_slug).toBe("k3m8q2xz");
    expectTypeOf<Workout["share_slug"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Workout["warnings"]>().toEqualTypeOf<string[]>();
  });
});

describe("activity-text data model", () => {
  const topSet: TopSet = { weight: 315, unit: "lb", reps: 4 };

  const exerciseSummary: ExerciseSummary = {
    name: "Deadlift",
    equipment: "Barbell",
    top_set: topSet,
    total_volume: 3780,
    total_reps: 12,
    sets: [warmup, weightReps],
  };

  const summary: WorkoutSummary = {
    workout_name: "Early Morning Workout",
    started_at: "2026-09-09T06:43:00",
    total_volume: 19_650,
    total_reps: 105,
    total_sets: 12,
    exercises: [exerciseSummary],
  };

  it("carries every WorkoutSummary field", () => {
    expect(Object.keys(summary).sort()).toStrictEqual([
      "exercises",
      "started_at",
      "total_reps",
      "total_sets",
      "total_volume",
      "workout_name",
    ]);
    expectTypeOf<WorkoutSummary["exercises"]>().toEqualTypeOf<
      ExerciseSummary[]
    >();
  });

  it("allows a null top set for an exercise with no working set", () => {
    const bodyweightOnly: ExerciseSummary = {
      name: "Plank",
      equipment: null,
      top_set: null,
      total_volume: 0,
      total_reps: 0,
      sets: [timed],
    };

    expect(bodyweightOnly.top_set).toBeNull();
    expect(exerciseSummary.top_set).toStrictEqual({
      weight: 315,
      unit: "lb",
      reps: 4,
    });
    expectTypeOf<ExerciseSummary["top_set"]>().toEqualTypeOf<TopSet | null>();
    expectTypeOf<ExerciseSummary["sets"]>().toEqualTypeOf<WorkoutSet[]>();
  });

  it("treats an unseen exercise as an empty HistoryContext", () => {
    const empty: HistoryContext = { per_exercise: {}, pr_flags: {} };

    expect(empty.per_exercise).toStrictEqual({});
    expect(empty.pr_flags).toStrictEqual({});
    expectTypeOf<HistoryContext["pr_flags"]>().toEqualTypeOf<
      Record<string, boolean>
    >();
  });

  it("nulls every ExerciseHistory field that has no data behind it", () => {
    const firstTime: ExerciseHistory = {
      best_e1rm: null,
      best_top_set: null,
      days_since_last: null,
      volume_trend: null,
    };
    const seenBefore: ExerciseHistory = {
      best_e1rm: 352.8,
      best_top_set: topSet,
      days_since_last: 7,
      volume_trend: "up",
    };
    const context: HistoryContext = {
      per_exercise: { Deadlift: seenBefore, Plank: firstTime },
      pr_flags: { "Deadlift:weight": true },
    };

    expect(context.per_exercise["Plank"]).toStrictEqual(firstTime);
    expect(context.per_exercise["Deadlift"]?.volume_trend).toBe("up");
    expect(context.pr_flags["Deadlift:weight"]).toBe(true);
    expectTypeOf<ExerciseHistory["days_since_last"]>().toEqualTypeOf<
      number | null
    >();
    expectTypeOf<ExerciseHistory["volume_trend"]>().toEqualTypeOf<
      "up" | "down" | "flat" | null
    >();
  });

  it("returns activity text as a plain title and description pair", () => {
    const text: ActivityText = {
      title: "Early Morning Workout",
      description: "19,650 lb across 12 sets.",
    };

    expect(Object.keys(text).sort()).toStrictEqual(["description", "title"]);
    expectTypeOf<ActivityText>().toEqualTypeOf<{
      title: string;
      description: string;
    }>();
  });
});

describe("module boundaries", () => {
  const source = readFileSync(
    new URL("../app/models.ts", import.meta.url),
    "utf8",
  );

  it("declares types only, with no runtime import or value export", () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bfrom\s+["']/);
    expect(source).not.toMatch(
      /^\s*export\s+(?:const|let|var|function|class|enum)\b/m,
    );
  });
});
