/**
 * Strong share-text parser: grammar, the nine parsing rules, and every set
 * payload variant of docs/planning/02-input-contract.md (§3).
 *
 * Scope (T10): structure only. Per-set `volume`, the working-set totals, each
 * exercise's top set, `dedupe_key`, `content_hash`, and `elapsed_s` are §3
 * "Derived values"/"Duration" and belong to T11; every set produced here
 * carries `volume: 0` as a placeholder for that pass.
 *
 * Two rules shape the control flow below and are not negotiable:
 * - Rule 9 / constraint 5: an unrecognized payload becomes `kind="unparsed"`
 *   with its raw text. The parser never throws on a payload it cannot read.
 * - Rule 1: only the two mandatory header lines can fail a parse.
 *
 * Warnings carry line numbers, never line content, so that a caller logging
 * them cannot leak `raw_text` (constraint 7).
 */

import { DateTime } from "luxon";

import type {
  DistanceUnit,
  Exercise,
  WeightUnit,
  Workout,
  WorkoutSet,
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
  const warnings: string[] = [];

  // Rule 1: the first two non-blank lines are the header. Rule 2 lets blank
  // lines precede it without meaning anything.
  let cursor = skipBlank(lines, 0);
  const titleLine = lines[cursor];
  if (titleLine === undefined) {
    throw new ParseError("Share text is missing its workout name (line 1).");
  }

  cursor = skipBlank(lines, cursor + 1);
  const dateLine = lines[cursor];
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

  let current: Exercise | undefined;

  for (let i = cursor + 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    const lineNumber = i + 1;

    // Rule 2: blank lines separate blocks and carry no meaning.
    if (line === "") {
      continue;
    }

    // Rule 5: the share link, wherever it appears.
    const link = SHARE_LINK.exec(line);
    if (link !== null) {
      const slug = link[1] ?? "";
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
      if (current === undefined) {
        warnings.push(
          `line ${lineNumber}: set line before any exercise line`,
        );
        continue;
      }
      current.sets.push(buildSet(set[1] ?? "", (set[2] ?? "").trimEnd()));
      continue;
    }

    // Rule 4: anything else non-blank starts a new exercise block.
    current = parseExerciseLine(line);
    workout.exercises.push(current);
  }

  return workout;
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
    name: (match[1] ?? "").trim(),
    equipment: (match[2] ?? "").trim(),
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
      duration_s: toSeconds(distanceTime[3] ?? ""),
      distance: toNumber(distanceTime[1] ?? ""),
      distance_unit: toDistanceUnit(distanceTime[2] ?? ""),
    };
  }

  const assisted = ASSISTED_REPS.exec(payload);
  if (assisted !== null) {
    const magnitude = toNumber(assisted[2] ?? "");
    return {
      ...base,
      kind: "assisted_reps",
      // §3: a negative load means machine assistance; keep the sign verbatim.
      weight: assisted[1] === "-" ? -magnitude : magnitude,
      unit: toWeightUnit(assisted[3] ?? ""),
      reps: toNumber(assisted[4] ?? ""),
      duration_s: null,
      distance: null,
      distance_unit: null,
    };
  }

  const weightReps = WEIGHT_REPS.exec(payload);
  if (weightReps !== null) {
    return {
      ...base,
      kind: "weight_reps",
      weight: toNumber(weightReps[1] ?? ""),
      unit: toWeightUnit(weightReps[2] ?? ""),
      reps: toNumber(weightReps[3] ?? ""),
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
      reps: toNumber(reps[1] ?? ""),
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
      duration_s: toSeconds(clock[1] ?? ""),
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
      distance: toNumber(distance[1] ?? ""),
      distance_unit: toDistanceUnit(distance[2] ?? ""),
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

function skipBlank(lines: string[], from: number): number {
  let index = from;
  while (index < lines.length && (lines[index] ?? "").trim() === "") {
    index += 1;
  }
  return index;
}

/** `M:SS` or `H:MM:SS` to seconds. */
function toSeconds(clock: string): number {
  return clock
    .split(":")
    .reduce((total, part) => total * 60 + Number(part), 0);
}

function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function toWeightUnit(raw: string): WeightUnit {
  return raw.toLowerCase() as WeightUnit;
}

function toDistanceUnit(raw: string): DistanceUnit {
  return raw.toLowerCase() as DistanceUnit;
}
