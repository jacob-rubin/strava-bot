/**
 * scripts/reparse.ts — re-parse stored `raw_text` after a parser change and
 * report what the current parser would produce (docs/reference/configuration.md).
 *
 * Every `workouts` document keeps `raw_text` verbatim, including the
 * ones whose parse failed (constraint 6), precisely so a parser fix can be
 * replayed over history. This script is that replay: it reads each document,
 * runs the current parser over the stored text, and diffs the result against
 * the stored `parsed` map.
 *
 * It is a parsing backfill, not a replay of ingest:
 *
 * - The default is a dry run. Nothing is written unless `--write` is passed.
 * - A write touches the `parsed` field and nothing else. `strava`, `status`,
 *   `error`, `attempts`, and the `history` collection are never read for
 *   update or modified, so a backfill can never advance a personal best or
 *   restate the outcome of a post.
 * - Nothing here talks to Strava. The module deliberately imports no Strava
 *   client, so no code path can create or re-create an activity.
 *
 * The headline number is the count of sets whose `kind` moved away from
 * `unparsed`: that is the measure of progress on open item 5 (set-format
 * coverage beyond the six known variants). The remaining `unparsed` count is
 * what is still unrecognized.
 *
 * Constraint 7: no secret is printed. `raw_text` may be logged, but this
 * script has no reason to echo whole payloads, so string values in the diff
 * output are truncated to {@link MAX_VALUE_CHARS}.
 */

import { Firestore } from "@google-cloud/firestore";
import { pathToFileURL } from "node:url";

import type { Workout, WorkoutSet } from "../app/models.js";
import { ParseError, parseWorkout } from "../app/parser.js";

const WORKOUTS_COLLECTION = "workouts";

/** Longest string value echoed in a diff line before it is elided. */
const MAX_VALUE_CHARS = 60;

/** Most diff lines printed per document before the rest are summarized. */
const MAX_CHANGES_SHOWN = 20;

/** An error whose message was authored here and is therefore safe to print. */
export class ReparseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReparseError";
  }
}

// --- CLI --------------------------------------------------------------------

/** Dry run reports only; writing back requires the explicit `--write` flag. */
export type ReparseMode = "dry-run" | "write";

export interface ReparseOptions {
  mode: ReparseMode;
  help: boolean;
}

export const USAGE = [
  "Usage: tsx scripts/reparse.ts [--dry-run | --write]",
  "",
  "  --dry-run  Report differences without writing. This is the default.",
  "  --write    Persist the re-parsed 'parsed' map for documents that changed.",
  "  --help     Show this message.",
  "",
  "Re-parses the stored raw_text of every workouts document with the current",
  "parser. Only the 'parsed' field is ever written; strava, status, and",
  "history are never touched, and Strava is never called.",
].join("\n");

/**
 * Parse argv. The default is a dry run, so an accidental invocation cannot
 * write; `--write` has to be asked for by name, and asking for both modes at
 * once is an error rather than a silent precedence rule.
 */
export function parseArgs(argv: readonly string[]): ReparseOptions {
  let mode: ReparseMode | null = null;
  let help = false;

  for (const argument of argv) {
    switch (argument) {
      case "--help":
      case "-h":
        help = true;
        break;
      case "--dry-run":
        if (mode === "write") {
          throw new ReparseError("--dry-run and --write are mutually exclusive.");
        }
        mode = "dry-run";
        break;
      case "--write":
        if (mode === "dry-run") {
          throw new ReparseError("--dry-run and --write are mutually exclusive.");
        }
        mode = "write";
        break;
      default:
        throw new ReparseError(
          "Unrecognized argument " + JSON.stringify(argument) + ".\n" + USAGE,
        );
    }
  }

  return { mode: mode ?? "dry-run", help };
}

// --- Firestore seam ----------------------------------------------------------

/** The three fields a backfill needs; everything else on the document is out of bounds. */
export interface StoredWorkoutParse {
  id: string;
  raw_text: string;
  parsed: Workout | null;
}

export interface ReparseStore {
  listWorkouts(): Promise<StoredWorkoutParse[]>;
  /** Writes `parsed` alone, leaving every other field of the document as it was. */
  writeParsed(id: string, parsed: Workout): Promise<void>;
}

/** Adapt a real `@google-cloud/firestore` client to {@link ReparseStore}. */
export function firestoreReparseStore(db: Firestore): ReparseStore {
  const collection = db.collection(WORKOUTS_COLLECTION);
  return {
    listWorkouts: async () => {
      const snapshot = await collection.get();
      return snapshot.docs.map((document) => {
        const data = document.data() as Record<string, unknown>;
        const rawText = data["raw_text"];
        return {
          id: document.id,
          raw_text: typeof rawText === "string" ? rawText : "",
          parsed: (data["parsed"] ?? null) as Workout | null,
        };
      });
    },
    // A field-scoped update, not a set(): it cannot disturb strava, status,
    // error, attempts, or received_at even by omission.
    writeParsed: async (id, parsed) => {
      await collection.doc(id).update({ parsed });
    },
  };
}

// --- Diffing ------------------------------------------------------------------

export type DocumentOutcome =
  | "unchanged"
  | "changed"
  | "parse-error"
  | "regressed"
  | "empty-raw-text";

export interface DocumentDiff {
  id: string;
  outcome: DocumentOutcome;
  /** Human-readable `path: before -> after` lines. */
  changes: string[];
  /** Sets whose `kind` moved away from `unparsed` — progress on open item 5. */
  setsRecovered: number;
  /** Sets whose `kind` became `unparsed`; a parser regression if non-zero. */
  setsRegressed: number;
  unparsedBefore: number;
  unparsedAfter: number;
  /** Only set for `parse-error`; always a message authored in app/parser.ts. */
  message: string | null;
  /** The re-parsed workout, or null when the current parser still rejects the text. */
  next: Workout | null;
}

/**
 * Re-parse one document and describe the difference.
 *
 * A document whose text no longer parses at all is reported as
 * `parse-error` and never written: constraint 6 keeps `raw_text` so the
 * parser can be fixed, and overwriting a previously good `parsed` map with
 * null would throw away the very history this script exists to preserve.
 */
export function diffDocument(stored: StoredWorkoutParse): DocumentDiff {
  const base = {
    id: stored.id,
    changes: [] as string[],
    setsRecovered: 0,
    setsRegressed: 0,
    unparsedBefore: countUnparsed(stored.parsed),
    unparsedAfter: countUnparsed(stored.parsed),
    message: null as string | null,
    next: null as Workout | null,
  };

  if (stored.raw_text === "") {
    return { ...base, outcome: "empty-raw-text" };
  }

  let next: Workout;
  try {
    next = parseWorkout(stored.raw_text);
  } catch (error: unknown) {
    if (error instanceof ParseError) {
      return { ...base, outcome: "parse-error", message: error.message };
    }
    throw error;
  }

  const kindMoves = countSetKindMoves(stored.parsed, next);
  const changes = diffValues(stored.parsed, next, "parsed");
  const unparsedAfter = countUnparsed(next);
  const outcome: DocumentOutcome =
    changes.length === 0
      ? "unchanged"
      : kindMoves.regressed > 0
        ? "regressed"
        : "changed";

  return {
    ...base,
    outcome,
    changes,
    setsRecovered: kindMoves.recovered,
    setsRegressed: kindMoves.regressed,
    unparsedAfter,
    next,
  };
}

/**
 * Structural diff of two JSON-shaped values, rendered as one line per leaf
 * difference. Arrays are compared positionally, which is the right alignment
 * here: a re-parse of the same text keeps set and exercise order (input contract rule 3),
 * so position identifies the same line before and after.
 */
export function diffValues(before: unknown, after: unknown, path: string): string[] {
  if (Object.is(before, after)) {
    return [];
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const lines: string[] = [];
    if (before.length !== after.length) {
      lines.push(path + ".length: " + before.length + " -> " + after.length);
    }
    const shared = Math.min(before.length, after.length);
    for (let i = 0; i < shared; i += 1) {
      lines.push(...diffValues(before[i], after[i], path + "[" + i + "]"));
    }
    return lines;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const lines: string[] = [];
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
      lines.push(...diffValues(before[key], after[key], path + "." + key));
    }
    return lines;
  }

  return [path + ": " + render(before) + " -> " + render(after)];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Render one leaf value, truncating long strings (constraint 7 hygiene). */
function render(value: unknown): string {
  if (value === undefined) {
    return "(absent)";
  }
  if (typeof value === "string") {
    const text = value.length > MAX_VALUE_CHARS
      ? value.slice(0, MAX_VALUE_CHARS) + "…"
      : value;
    return JSON.stringify(text);
  }
  if (isPlainObject(value) || Array.isArray(value)) {
    return Array.isArray(value) ? "[" + value.length + " items]" : "{object}";
  }
  return JSON.stringify(value) ?? String(value);
}

/** Every set of a workout, in document order. */
function allSets(workout: Workout | null): WorkoutSet[] {
  if (workout === null) {
    return [];
  }
  return workout.exercises.flatMap((exercise) => exercise.sets ?? []);
}

/** Constraint 5: an unrecognized payload is retained as `kind="unparsed"`. */
function countUnparsed(workout: Workout | null): number {
  return allSets(workout).filter((set) => set.kind === "unparsed").length;
}

/**
 * Sets that changed `kind` in either direction, aligned positionally across
 * the whole workout. Recovery is the open item 5 metric; a regression means
 * the current parser understands less than the stored map did and is worth
 * shouting about.
 */
export function countSetKindMoves(
  before: Workout | null,
  after: Workout | null,
): { recovered: number; regressed: number } {
  const beforeSets = allSets(before);
  const afterSets = allSets(after);
  let recovered = 0;
  let regressed = 0;

  for (let i = 0; i < Math.min(beforeSets.length, afterSets.length); i += 1) {
    const from = beforeSets[i]?.kind;
    const to = afterSets[i]?.kind;
    if (from === to) {
      continue;
    }
    if (from === "unparsed") {
      recovered += 1;
    } else if (to === "unparsed") {
      regressed += 1;
    }
  }

  return { recovered, regressed };
}

// --- Report -------------------------------------------------------------------

export interface ReparseReport {
  mode: ReparseMode;
  diffs: DocumentDiff[];
  written: string[];
}

/** Render the report exactly as the script prints it, one line per element. */
export function formatReport(report: ReparseReport): string[] {
  const lines: string[] = [];
  const { diffs } = report;

  lines.push(
    report.mode === "dry-run"
      ? "reparse: dry run — reporting only, no writes"
      : "reparse: write mode — changed 'parsed' maps will be persisted",
  );
  lines.push("collection: " + WORKOUTS_COLLECTION);
  lines.push("");

  if (diffs.length === 0) {
    lines.push("(no workouts documents found)");
  }

  for (const diff of diffs) {
    lines.push(diff.id + ": " + describeOutcome(diff));
    for (const change of diff.changes.slice(0, MAX_CHANGES_SHOWN)) {
      lines.push("    " + change);
    }
    if (diff.changes.length > MAX_CHANGES_SHOWN) {
      lines.push(
        "    … " + (diff.changes.length - MAX_CHANGES_SHOWN) + " more changes",
      );
    }
  }

  const changed = diffs.filter(
    (diff) => diff.outcome === "changed" || diff.outcome === "regressed",
  ).length;
  const parseErrors = diffs.filter((diff) => diff.outcome === "parse-error").length;
  const recovered = sum(diffs.map((diff) => diff.setsRecovered));
  const regressed = sum(diffs.map((diff) => diff.setsRegressed));
  const unparsedAfter = sum(diffs.map((diff) => diff.unparsedAfter));
  const unparsedBefore = sum(diffs.map((diff) => diff.unparsedBefore));

  lines.push("");
  lines.push(
    "scanned " + diffs.length + " document(s): " + changed + " changed, " +
      parseErrors + " still unparsable",
  );
  lines.push(
    "sets recovered from unparsed: " + recovered +
      (regressed > 0 ? " (WARNING: " + regressed + " regressed to unparsed)" : ""),
  );
  lines.push(
    "unparsed sets: " + unparsedBefore + " stored -> " + unparsedAfter +
      " after re-parse (open item 5)",
  );
  lines.push(
    report.mode === "dry-run"
      ? "dry run: no documents were written"
      : "wrote 'parsed' for " + report.written.length + " document(s)" +
        (report.written.length > 0 ? ": " + report.written.join(", ") : ""),
  );

  return lines;
}

function describeOutcome(diff: DocumentDiff): string {
  switch (diff.outcome) {
    case "unchanged":
      return "unchanged";
    case "empty-raw-text":
      return "skipped — no raw_text stored";
    case "parse-error":
      return "still unparsable — " + (diff.message ?? "parse failed");
    case "regressed":
    case "changed": {
      const parts = [diff.changes.length + " field change(s)"];
      if (diff.setsRecovered > 0) {
        parts.push(diff.setsRecovered + " set(s) recovered from unparsed");
      }
      if (diff.setsRegressed > 0) {
        parts.push("WARNING: " + diff.setsRegressed + " set(s) now unparsed");
      }
      return diff.outcome + " — " + parts.join(", ");
    }
  }
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// --- Orchestration ---------------------------------------------------------------

/**
 * Re-parse every stored document and, in write mode, persist the `parsed`
 * maps that actually changed. A document that is unchanged, unparsable, or
 * missing its `raw_text` is never written.
 */
export async function reparse(
  store: ReparseStore,
  options: ReparseOptions,
): Promise<ReparseReport> {
  const stored = await store.listWorkouts();
  const diffs = stored.map(diffDocument);
  const written: string[] = [];

  if (options.mode === "write") {
    for (const diff of diffs) {
      if (diff.next === null || diff.changes.length === 0) {
        continue;
      }
      await store.writeParsed(diff.id, diff.next);
      written.push(diff.id);
    }
  }

  return { mode: options.mode, diffs, written };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const store = firestoreReparseStore(new Firestore());
  const report = await reparse(store, options);
  for (const line of formatReport(report)) {
    console.log(line);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error: unknown) => {
    // Only messages authored in this repo are printed verbatim; anything else
    // could in principle carry credential material (constraint 7).
    if (error instanceof ReparseError) {
      console.error(error.message);
    } else {
      console.error("Re-parse failed.");
    }
    process.exitCode = 1;
  });
}
