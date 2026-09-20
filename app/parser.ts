import { createHash } from "node:crypto";
import { DateTime } from "luxon";

import type {
  DistanceUnit,
  Exercise,
  TopSet,
  WeightUnit,
  Workout,
  WorkoutSet,
  WorkoutSummary,
} from "./models.js";

/** Luxon format of `date_line` (§3 grammar). Naive local time, no offset. */
export const DATE_LINE_FORMAT = "cccc, LLLL d, yyyy 'at' h:mm a";

/** Naive ISO-8601 rendering of `started_at`, e.g. `2026-09-09T06:43:00`. */
const NAIVE_ISO_FORMAT = "yyyy-MM-dd'T'HH:mm:ss";

/**
 * Raised only by the two mandatory lines of rule 1. Everything else in §3
 * degrades to a warning or to `kind="unparsed"`.
 */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

/** Rule 3: `Set <index>: <payload>`. The index token is free-form (`1`, `W`). */
const SET_LINE = /^Set\s+(\S+):\s*(.*)$/;

/** Rule 5: the share link, with its slug captured. */
const SHARE_LINK = /^https?:\/\/link\.strong\.app\/(\S+)$/;

/** Rule 7: an exercise name's optional trailing equipment parenthetical. */
const EQUIPMENT = /^(.*\S)\s*\(([^()]+)\)$/;

/** Rule 8: a set index beginning with `W` marks a warmup, case-insensitively. */
const WARMUP_INDEX = /^w/i;

const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
/** Rule 6: Strong emits U+00D7, but the letter `x` must parse identically. */
const MULTIPLY = String.raw`[\u00d7x]`;
const CLOCK = String.raw`\d+:[0-5]\d(?::[0-5]\d)?`;

/**
 * §3 set payload variants, ordered most specific first: `distance_time` before
 * `distance` and `time`, and signed `assisted_reps` before `weight_reps`.
 */
const DISTANCE_TIME = new RegExp(
  `^(${NUMBER})\\s*(mi|km|m|ft)\\s+in\\s+(${CLOCK})$`,
  "i",
);
const ASSISTED_REPS = new RegExp(
  `^([+-])\\s*(${NUMBER})\\s*(lb|kg)\\s*${MULTIPLY}\\s*(\\d+)$`,
  "i",
);
const WEIGHT_REPS = new RegExp(
  `^(${NUMBER})\\s*(lb|kg)\\s*${MULTIPLY}\\s*(\\d+)$`,
  "i",
);
const BARE_REPS = /^(\d+)\s*reps?$/i;
const CLOCK_ONLY = new RegExp(`^(${CLOCK})$`);
const DISTANCE = new RegExp(`^(${NUMBER})\\s*(mi|km|m|ft)$`, "i");

/**
 * Parse one Strong share text into a {@link Workout}.
 *
 * @throws {ParseError} when line 1 or line 2 of rule 1 is missing, or when
 * line 2 does not match {@link DATE_LINE_FORMAT}.
 */
export function parseWorkout(text: string): Workout {
  const lines = text.split(/\r\n|\r|\n/);
  // Constraint 7 safety boundary: warnings carry line numbers, never content.
  const warnings: string[] = [];

  // Rule 1: the first two non-blank lines are the header. Rule 2 lets blank
  // lines precede it without meaning anything.
  const titleCursor = skipBlank(lines, 0);
  const titleLine = lines[titleCursor];
  if (titleLine === undefined) {
    throw new ParseError("Share text is missing its workout name (line 1).");
  }

  const dateCursor = skipBlank(lines, titleCursor + 1);
  const dateLine = lines[dateCursor];
  if (dateLine === undefined) {
    throw new ParseError("Share text is missing its start timestamp (line 2).");
  }

  const workout: Workout = {
    workout_name: titleLine.trim(),
    started_at: parseDateLine(dateLine),
    exercises: [],
    share_slug: null,
    warnings,
  };

  for (const [i, rawLine] of lines.entries()) {
    if (i <= dateCursor) {
      continue;
    }

    const line = rawLine.trim();
    const lineNumber = i + 1;

    // Rule 2: blank lines separate blocks and carry no meaning.
    if (line === "") {
      continue;
    }

    // Rule 5: the share link, wherever it appears.
    const link = SHARE_LINK.exec(line);
    if (link !== null) {
      const slug = group(link, 1);
      if (workout.share_slug === null) {
        workout.share_slug = slug;
      } else {
        warnings.push(`line ${lineNumber}: extra share link ignored`);
      }
      continue;
    }

    // Rule 3: a set belongs to the most recent exercise line.
    const set = SET_LINE.exec(line);
    if (set !== null) {
      const current = workout.exercises.at(-1);
      if (current === undefined) {
        warnings.push(
          `line ${lineNumber}: set line before any exercise line`,
        );
        continue;
      }
      current.sets.push(buildSet(group(set, 1), group(set, 2).trimEnd()));
      continue;
    }

    // Rule 4: anything else non-blank starts a new exercise block.
    workout.exercises.push(parseExerciseLine(line));
  }

  return workout;
}

/** §3 derived values: per-set volume is `weight × reps`, 0 when either absent. */
export function setVolume(
  set: Pick<WorkoutSet, "weight" | "reps">,
): number {
  if (set.weight === null || set.reps === null) {
    return 0;
  }
  return set.weight * set.reps;
}

/** §3 derived values: the three working-set-only totals. */
export type WorkingSetTotals = {
  total_volume: number;
  total_reps: number;
  total_sets: number;
};

export function workingSetTotals(
  workout: Pick<Workout, "exercises">,
): WorkingSetTotals {
  const totals: WorkingSetTotals = {
    total_volume: 0,
    total_reps: 0,
    total_sets: 0,
  };

  for (const exercise of workout.exercises) {
    for (const set of exercise.sets) {
      if (set.is_warmup) {
        continue;
      }
      totals.total_sets += 1;
      totals.total_volume += setVolume(set);
      totals.total_reps += set.reps ?? 0;
    }
  }

  return totals;
}

/**
 * §3 derived values: an exercise's working set with the greatest `(weight,
 * reps)` pair lexicographically. Exercises with no weight-bearing working set
 * have no top set.
 */
export function exerciseTopSet(
  exercise: Pick<Exercise, "sets">,
): TopSet | null {
  return exercise.sets.reduce<TopSet | null>((best, set) => {
    if (set.is_warmup || set.weight === null || set.reps === null) {
      return best;
    }

    if (
      best === null ||
      set.weight > best.weight ||
      (set.weight === best.weight && set.reps > best.reps)
    ) {
      return { weight: set.weight, unit: set.unit, reps: set.reps };
    }

    return best;
  }, null);
}

/** §6: the `dedupe_key` rule-2 seed shared by `dedupe_key` and `content_hash`. */
function dedupeSeed(
  workout: Pick<Workout, "started_at" | "exercises">,
): string {
  return [
    workout.started_at,
    ...workout.exercises.map(
      (exercise) => `${exercise.name}:${exercise.sets.length}`,
    ),
  ].join("|");
}

/**
 * §6: `content_hash` is computed on every ingest so dedup stays correct even
 * if the share-link slug is unstable (ADR 0003).
 */
export function contentHash(
  workout: Pick<Workout, "started_at" | "exercises">,
): string {
  const digest = createHash("sha256")
    .update(dedupeSeed(workout), "utf8")
    .digest("hex")
    .slice(0, 32);
  return `sha256:${digest}`;
}

/** §6: `dedupe_key` derivation, rule 1 then rule 2. */
export function dedupeKey(
  workout: Pick<Workout, "share_slug" | "started_at" | "exercises">,
): string {
  if (workout.share_slug !== null) {
    return `strong:${workout.share_slug}`;
  }
  return contentHash(workout);
}

/** §3 duration: the 4-hour cap above which elapsed falls back. */
export const ELAPSED_CAP_S = 14_400;
/** §3 duration: fallback seconds per working set. */
const ELAPSED_PER_SET_S = 165;
/** §3 duration: minimum fallback elapsed. */
const ELAPSED_MIN_S = 600;

/**
 * §3 duration: `elapsed_s` with the two-branch formula.
 *
 * `receivedAt` is server receipt time converted to the workout's local wall
 * clock, matching the parser's naive `started_at`. `capSeconds` is the
 * `ELAPSED_CAP_S` bound and can be overridden in tests or by configuration.
 */
export function elapsedSeconds(
  startedAt: string,
  receivedAt: DateTime,
  totalSets: number,
  capSeconds: number = ELAPSED_CAP_S,
): number {
  const zone = receivedAt.zoneName ?? "utc";
  const started = DateTime.fromISO(startedAt, { zone: "utc" }).setZone(zone, {
    keepLocalTime: true,
  });
  const deltaSeconds = receivedAt.diff(started, "seconds").seconds;

  if (deltaSeconds > 0 && deltaSeconds <= capSeconds) {
    return Math.round(deltaSeconds);
  }

  return Math.max(ELAPSED_MIN_S, totalSets * ELAPSED_PER_SET_S);
}

/** Build the §6 `WorkoutSummary` (and per-exercise summaries) from parser output. */
export function summarizeWorkout(workout: Workout): WorkoutSummary {
  const totals = workingSetTotals(workout);

  return {
    workout_name: workout.workout_name,
    started_at: workout.started_at,
    total_volume: totals.total_volume,
    total_reps: totals.total_reps,
    total_sets: totals.total_sets,
    exercises: workout.exercises.map((exercise) => {
      const exerciseTotals = workingSetTotals({ exercises: [exercise] });
      return {
        name: exercise.name,
        equipment: exercise.equipment,
        top_set: exerciseTopSet(exercise),
        total_volume: exerciseTotals.total_volume,
        total_reps: exerciseTotals.total_reps,
        sets: exercise.sets,
      };
    }),
  };
}

/**
 * Rule 1 / §3 duration: `date_line` is naive local wall clock. It is parsed in
 * UTC purely so that a DST gap in `LOCAL_TZ` cannot invalidate a timestamp the
 * user really recorded; the result is rendered back without offset or zone.
 */
function parseDateLine(line: string): string {
  const normalized = line.trim().replace(/[\u00a0\u2007\u2009\u202f]/g, " ");
  const parsed = DateTime.fromFormat(normalized, DATE_LINE_FORMAT, {
    zone: "utc",
    locale: "en-US",
  });

  if (!parsed.isValid) {
    throw new ParseError("Line 2 is not a Strong start timestamp.");
  }

  return parsed.toFormat(NAIVE_ISO_FORMAT);
}

/** Rule 7: split a trailing `(equipment)` parenthetical off the base name. */
function parseExerciseLine(line: string): Exercise {
  const match = EQUIPMENT.exec(line);
  if (match === null) {
    return { name: line, equipment: null, sets: [] };
  }

  return {
    name: group(match, 1).trim(),
    equipment: group(match, 2).trim(),
    sets: [],
  };
}

/**
 * Classify one set payload against the §3 variant table, falling through to
 * `kind="unparsed"` with the raw payload (rule 9 / constraint 5).
 */
function buildSet(index: string, payload: string): WorkoutSet {
  const is_warmup = WARMUP_INDEX.test(index);
  const base = { index, is_warmup, volume: 0 } as const;

  const distanceTime = DISTANCE_TIME.exec(payload);
  if (distanceTime !== null) {
    return {
      ...base,
      kind: "distance_time",
      weight: null,
      unit: null,
      reps: null,
      duration_s: toSeconds(group(distanceTime, 3)),
      distance: toNumber(group(distanceTime, 1)),
      distance_unit: toDistanceUnit(group(distanceTime, 2)),
    };
  }

  const assisted = ASSISTED_REPS.exec(payload);
  if (assisted !== null) {
    const magnitude = toNumber(group(assisted, 2));
    const weight = group(assisted, 1) === "-" ? -magnitude : magnitude;
    const reps = toNumber(group(assisted, 4));
    return {
      ...base,
      kind: "assisted_reps",
      // §3: a negative load means machine assistance; keep the sign verbatim.
      weight,
      unit: toWeightUnit(group(assisted, 3)),
      reps,
      volume: setVolume({ weight, reps }),
      duration_s: null,
      distance: null,
      distance_unit: null,
    };
  }

  const weightReps = WEIGHT_REPS.exec(payload);
  if (weightReps !== null) {
    const weight = toNumber(group(weightReps, 1));
    const reps = toNumber(group(weightReps, 3));
    return {
      ...base,
      kind: "weight_reps",
      weight,
      unit: toWeightUnit(group(weightReps, 2)),
      reps,
      volume: setVolume({ weight, reps }),
      duration_s: null,
      distance: null,
      distance_unit: null,
    };
  }

  const reps = BARE_REPS.exec(payload);
  if (reps !== null) {
    return {
      ...base,
      kind: "reps",
      weight: null,
      unit: null,
      reps: toNumber(group(reps, 1)),
      duration_s: null,
      distance: null,
      distance_unit: null,
    };
  }

  const clock = CLOCK_ONLY.exec(payload);
  if (clock !== null) {
    return {
      ...base,
      kind: "time",
      weight: null,
      unit: null,
      reps: null,
      duration_s: toSeconds(group(clock, 1)),
      distance: null,
      distance_unit: null,
    };
  }

  const distance = DISTANCE.exec(payload);
  if (distance !== null) {
    return {
      ...base,
      kind: "distance",
      weight: null,
      unit: null,
      reps: null,
      duration_s: null,
      distance: toNumber(group(distance, 1)),
      distance_unit: toDistanceUnit(group(distance, 2)),
    };
  }

  return {
    ...base,
    kind: "unparsed",
    raw: payload,
    weight: null,
    unit: null,
    reps: null,
    duration_s: null,
    distance: null,
    distance_unit: null,
  };
}

/** Invariant: every capture group participates on match; a miss is a parser bug. */
function group(match: RegExpExecArray, index: number): string {
  const value = match[index];
  if (value === undefined) {
    throw new Error(`parser bug: capture group ${index} did not participate`);
  }
  return value;
}

function skipBlank(lines: readonly string[], from: number): number {
  const index = lines.findIndex((line, i) => i >= from && line.trim() !== "");
  return index === -1 ? lines.length : index;
}

/** §3 time payload: `M:SS` or `H:MM:SS` to seconds. */
function toSeconds(clock: string): number {
  return clock
    .split(":")
    .reduce((total, part) => total * 60 + Number(part), 0);
}

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function toWeightUnit(raw: string): WeightUnit {
  const unit = raw.toLowerCase();
  if (unit === "lb" || unit === "kg") {
    return unit;
  }
  throw new Error(`parser bug: unrecognized weight unit ${unit}`);
}

function toDistanceUnit(raw: string): DistanceUnit {
  const unit = raw.toLowerCase();
  if (unit === "mi" || unit === "km" || unit === "m" || unit === "ft") {
    return unit;
  }
  throw new Error(`parser bug: unrecognized distance unit ${unit}`);
}
