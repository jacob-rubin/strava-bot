/**
 * T10 covers the §3 grammar and the set payload variants. The full §12
 * acceptance sweep — totals, top set, dedupe key — lands with T11/T12.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ParseError, parseWorkout } from "../app/parser.js";
import type { Workout } from "../app/models.js";

function fixture(name: string): string {
  return readFileSync(
    new URL(`./fixtures/${name}.txt`, import.meta.url),
    "utf8",
  );
}

function parseFixture(name: string): Workout {
  return parseWorkout(fixture(name));
}

const SHARE_TEXT_FIXTURES = [
  "assisted",
  "canonical",
  "canonical-x",
  "distance-time",
  "no-share-link",
  "reps",
  "time",
  "unparsed",
  "warmup",
];

describe("grammar", () => {
  const canonical = parseFixture("canonical");

  it("reads the title line, the date line, and four exercise blocks", () => {
    expect(canonical.workout_name).toBe("Early Morning Workout");
    expect(canonical.started_at).toBe("2026-09-09T06:43:00");
    expect(canonical.started_at).not.toMatch(/[Zz]|[+-]\d{2}:\d{2}$/);
    expect(canonical.exercises).toHaveLength(4);
  });

  it("binds each set line to the most recent exercise line", () => {
    expect(
      canonical.exercises.map((exercise) => [
        exercise.name,
        exercise.sets.length,
      ]),
    ).toStrictEqual([
      ["Deadlift", 3],
      ["Hack Squat", 3],
      ["Leg Extension", 3],
      ["Calf Press on Leg Press", 3],
    ]);
  });

  it("splits trailing equipment off the exercise name", () => {
    expect(canonical.exercises.map((exercise) => exercise.equipment))
      .toStrictEqual(["Barbell", null, "Machine", null]);
  });

  it("captures the share-link slug and nulls it when absent", () => {
    expect(canonical.share_slug).toBe("gvvdfvga");
    expect(parseFixture("no-share-link").share_slug).toBeNull();
  });

  it("treats blank lines as separators only", () => {
    const padded = parseWorkout(
      "\n\nPadded Workout\nWednesday, September 9, 2026 at 6:43 AM\n\n\nSquat\n\nSet 1: 225 lb \u00d7 5\n\n",
    );

    expect(padded.workout_name).toBe("Padded Workout");
    expect(padded.exercises).toHaveLength(1);
    expect(padded.exercises[0]?.sets).toHaveLength(1);
    expect(padded.warnings).toStrictEqual([]);
  });

  it("warns rather than fails on a set line before any exercise line", () => {
    const orphan = parseWorkout(
      "Orphan Workout\nWednesday, September 9, 2026 at 6:43 AM\n\nSet 1: 225 lb \u00d7 5\n\nSquat\nSet 1: 135 lb \u00d7 5\n",
    );

    expect(orphan.warnings).toStrictEqual([
      "line 4: set line before any exercise line",
    ]);
    expect(orphan.exercises).toHaveLength(1);
    expect(orphan.exercises[0]?.sets).toHaveLength(1);
  });

  it("keeps warnings free of line content so they are safe to log", () => {
    const orphan = parseWorkout(
      "Orphan Workout\nWednesday, September 9, 2026 at 6:43 AM\n\nSet 1: 225 lb \u00d7 5\n",
    );

    for (const warning of orphan.warnings) {
      expect(warning).not.toContain("225");
    }
  });

  it("fails only on the two mandatory header lines", () => {
    expect(() => parseWorkout(fixture("not-strong"))).toThrow(ParseError);
    expect(() => parseWorkout("Early Morning Workout\n")).toThrow(ParseError);
    expect(() => parseWorkout("")).toThrow(ParseError);
  });

  it("parses every share-text fixture without raising", () => {
    for (const name of SHARE_TEXT_FIXTURES) {
      expect(() => parseFixture(name), name).not.toThrow();
    }
  });
});

describe("set payload variants", () => {
  function firstSet(name: string) {
    const set = parseFixture(name).exercises[0]?.sets[0];
    if (set === undefined) {
      throw new Error(`fixture ${name} produced no sets`);
    }
    return set;
  }

  it("reads a weight_reps variant and accepts x for the multiplication sign", () => {
    const times = firstSet("canonical");
    const letterX = firstSet("canonical-x");

    expect(times).toStrictEqual({
      kind: "weight_reps",
      index: "1",
      is_warmup: false,
      volume: 0,
      weight: 315,
      unit: "lb",
      reps: 4,
      duration_s: null,
      distance: null,
      distance_unit: null,
    });
    expect(letterX).toStrictEqual(times);
    expect(parseFixture("canonical-x")).toStrictEqual(
      parseFixture("canonical"),
    );
  });

  it("marks a W-indexed set as a warmup and retains it in order", () => {
    const squat = parseFixture("warmup").exercises[0];

    expect(squat?.sets.map((set) => [set.index, set.is_warmup])).toStrictEqual([
      ["W", true],
      ["1", false],
    ]);
  });

  it("reads a bare reps variant with no load", () => {
    const set = firstSet("reps");

    expect(set.kind).toBe("reps");
    expect(set).toMatchObject({ reps: 12, weight: null, unit: null });
  });

  it("preserves the sign of an assisted_reps variant", () => {
    const pullUp = parseFixture("assisted").exercises[0];

    expect(pullUp?.sets.map((set) => [set.kind, set.weight])).toStrictEqual([
      ["assisted_reps", 25],
      ["assisted_reps", -40],
    ]);
    expect(pullUp?.sets[0]).toMatchObject({ unit: "lb", reps: 8 });
    expect(pullUp?.sets[1]).toMatchObject({ unit: "lb", reps: 10 });
  });

  it("reads a time variant as seconds", () => {
    const set = firstSet("time");

    expect(set.kind).toBe("time");
    expect(set.duration_s).toBe(90);
    expect(parseWorkout(
      "Timed\nWednesday, September 9, 2026 at 6:43 AM\n\nPlank\nSet 1: 1:02:30\n",
    ).exercises[0]?.sets[0]?.duration_s).toBe(3750);
  });

  it("reads a distance_time variant, and distance on its own", () => {
    expect(firstSet("distance-time")).toMatchObject({
      kind: "distance_time",
      distance: 0.25,
      distance_unit: "mi",
      duration_s: 190,
    });
    expect(parseWorkout(
      "Run\nWednesday, September 9, 2026 at 6:43 AM\n\nTreadmill\nSet 1: 1.5 mi\n",
    ).exercises[0]?.sets[0]).toMatchObject({
      kind: "distance",
      distance: 1.5,
      distance_unit: "mi",
      duration_s: null,
    });
  });

  it("retains an unrecognized variant as unparsed instead of dropping it", () => {
    const set = firstSet("unparsed");

    expect(set.kind).toBe("unparsed");
    expect(set).toMatchObject({ index: "2", raw: "something weird here" });
  });
});
