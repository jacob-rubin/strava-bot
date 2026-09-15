/**
 * Deterministic activity-title and description formatter (§8).
 *
 * Local and synchronous: no provider SDK, remote call, prompt, credential,
 * timeout, or fallback branch (Constraint 9). All comparative language comes
 * from the code-computed flags already present in HistoryContext (Constraint 10);
 * this module never infers a PR or a trend from raw numbers.
 */

import type {
  ActivityText,
  ExerciseSummary,
  HistoryContext,
  TopSet,
  WorkoutSummary,
} from "./models.js";

const TITLE_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 1_000;

/** Plain numeric rendering: no locale grouping, no unit normalization. */
function formatNumber(value: number): string {
  return String(value);
}

function formatTopSet(topSet: TopSet): string {
  return `${formatNumber(topSet.weight)} ${topSet.unit} x ${formatNumber(topSet.reps)}`;
}

/** Working sets only, matching the §6 totals (warmups stay excluded). */
function workingSetCount(exercise: ExerciseSummary): number {
  let count = 0;
  for (const set of exercise.sets) {
    if (!set.is_warmup) {
      count += 1;
    }
  }
  return count;
}

/**
 * True only when HistoryContext already carries a true PR flag for the exercise.
 * The formatter consumes explicit booleans; it never compares values itself.
 */
function hasPrFlag(
  prFlags: HistoryContext["pr_flags"],
  exerciseName: string,
): boolean {
  for (const [key, value] of Object.entries(prFlags)) {
    if (value === true && (key === exerciseName || key.startsWith(`${exerciseName}:`))) {
      return true;
    }
  }
  return false;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function describeExercise(
  exercise: ExerciseSummary,
  context: HistoryContext,
): string {
  const parts: string[] = [exercise.name];

  if (exercise.top_set !== null) {
    parts.push(`top set ${formatTopSet(exercise.top_set)}`);
  }
  parts.push(`${formatNumber(exercise.total_reps)} reps`);
  parts.push(`${formatNumber(exercise.total_volume)} volume`);
  parts.push(`${formatNumber(workingSetCount(exercise))} working sets`);

  const history = context.per_exercise[exercise.name];
  if (history !== undefined) {
    if (hasPrFlag(context.pr_flags, exercise.name)) {
      parts.push("PR");
    }
    if (history.volume_trend !== null) {
      parts.push(`volume trend ${history.volume_trend}`);
    }
    if (history.days_since_last !== null) {
      parts.push(`${formatNumber(history.days_since_last)} days since last`);
    }
  }

  return parts.join(", ");
}

export function formatActivityText(
  summary: WorkoutSummary,
  context: HistoryContext,
): ActivityText {
  const name = summary.workout_name.trim() || "Workout";

  const title = truncate(name, TITLE_MAX_LENGTH);

  const lines: string[] = [
    `${name}: ${formatNumber(summary.exercises.length)} exercises, ` +
      `${formatNumber(summary.total_sets)} working sets, ` +
      `${formatNumber(summary.total_reps)} reps, ` +
      `${formatNumber(summary.total_volume)} total volume`,
  ];

  for (const exercise of summary.exercises) {
    lines.push(describeExercise(exercise, context));
  }

  let description = lines.join(". ");
  if (!description.endsWith(".")) {
    description += ".";
  }
  description = truncate(description, DESCRIPTION_MAX_LENGTH);

  return { title, description };
}

