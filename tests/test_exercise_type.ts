import { describe, expect, it } from "vitest";

import {
  UNMAPPED_EXERCISE_TYPE,
  resolveExerciseType,
} from "../app/exercises/exercise_type.js";
import exerciseTypeMap from "../app/exercises/exercise_type_map.json" with { type: "json" };
import supportedExerciseTypes from "./fixtures/strava_exercise_types.json" with { type: "json" };

const UNMAPPED = { exercise_type: UNMAPPED_EXERCISE_TYPE, mapped: false };

describe("resolveExerciseType", () => {
  it("resolves a name and equipment pair to its Strava exercise", () => {
    expect(resolveExerciseType("Bench Press", "Barbell")).toStrictEqual({
      exercise_type: "BARBELL_BENCH_PRESS",
      mapped: true,
    });
  });

  it("uses the reserved default key when the parser reports no equipment", () => {
    expect(resolveExerciseType("Hack Squat", null)).toStrictEqual({
      exercise_type: "MACHINE_HACK_SQUAT",
      mapped: true,
    });
  });

  it("falls back to the generic when a known name has no default and unlisted equipment", () => {
    expect(resolveExerciseType("Bench Press", "Kettlebell")).toStrictEqual(
      UNMAPPED,
    );
  });

  it("falls back to the default when a known name has one and unlisted equipment", () => {
    expect(
      resolveExerciseType("Triceps Extension", "Resistance Band"),
    ).toStrictEqual({
      exercise_type: "TRICEPS_EXTENSION_GENERIC",
      mapped: true,
    });
  });

  it("reports an unmapped name rather than guessing an exercise", () => {
    expect(resolveExerciseType("Nonexistent Lift", null)).toStrictEqual(UNMAPPED);
  });

  // Strong emits U+2019, not an ASCII apostrophe; a normalized key would miss.
  it("matches a name carrying a typographic apostrophe", () => {
    expect(resolveExerciseType("Farmer\u2019s Carry", null)).toStrictEqual({
      exercise_type: "FARMERS_CARRY",
      mapped: true,
    });
    expect(resolveExerciseType("Farmer's Carry", null)).toStrictEqual(UNMAPPED);
  });

  // The parser's EQUIPMENT regex keeps a comma inside the parenthetical.
  it("matches an equipment value containing a comma", () => {
    expect(
      resolveExerciseType("Reverse Fly", "Cable, Single Arm"),
    ).toStrictEqual({
      exercise_type: "CABLE_REAR_DELT_FLY",
      mapped: true,
    });
    expect(resolveExerciseType("Reverse Fly", "Cable")).toStrictEqual({
      exercise_type: "CABLE_REAR_DELT_REVERSE_FLY",
      mapped: true,
    });
  });

  it("trims the surrounding whitespace of both parts before matching", () => {
    expect(resolveExerciseType("  Hack Squat  ", null)).toStrictEqual({
      exercise_type: "MACHINE_HACK_SQUAT",
      mapped: true,
    });
    expect(resolveExerciseType("Bench Press", " Barbell ")).toStrictEqual({
      exercise_type: "BARBELL_BENCH_PRESS",
      mapped: true,
    });
  });
});

describe("exercise_type_map.json", () => {
  // The guard against a typo: Strava silently generalizes an unknown value.
  it("only holds exercise types Strava documents", () => {
    const supported = new Set(Object.values(supportedExerciseTypes).flat());
    const offenders = Object.entries(exerciseTypeMap).flatMap(
      ([name, byEquipment]) =>
        Object.entries(byEquipment)
          .filter(([, exerciseType]) => !supported.has(exerciseType))
          .map(([equipment, exerciseType]) =>
            `${name} / ${equipment} -> ${exerciseType}`,
          ),
    );

    expect(offenders).toStrictEqual([]);
    expect(supported.has(UNMAPPED_EXERCISE_TYPE)).toBe(true);
  });

  it("covers the Strong export it was built from", () => {
    expect(Object.keys(exerciseTypeMap)).toHaveLength(81);
    const entries = Object.values(exerciseTypeMap).flatMap((byEquipment) =>
      Object.keys(byEquipment),
    );
    // 118 unique Strong names, less the four archived in Strong.
    expect(entries).toHaveLength(114);
  });
});

