import type {
  ActivityText,
  ExerciseSummary,
  HistoryContext,
  TopSet,
  WorkoutSummary,
  WorkoutSet,
} from "./models.js";

const TITLE_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 1_000;
const EXERCISE_BULLET = "\u2022";
const DESCRIPTION_FOOTER = "\n\nMade with love by strava bot";

/** Plain numeric rendering: no locale grouping, no unit normalization. */
function formatNumber(value: number): string {
  return String(value);
}

/** Working sets only, matching docs/reference/persistence.md (warmups excluded). */
function workingSets(exercise: ExerciseSummary): readonly WorkoutSet[] {
  return exercise.sets.filter((set) => !set.is_warmup);
}

/** Constraint 10: a load shared by every weighted set is stated flat; otherwise only as a ceiling. */
function formatLoad(topSet: TopSet, sets: readonly WorkoutSet[]): string {
  const load = `${formatNumber(topSet.weight)}${topSet.unit}`;
  const uniform = sets.every(
    (set) =>
      set.weight === null ||
      (set.weight === topSet.weight && set.unit === topSet.unit),
  );
  return uniform ? load : `up to ${load}`;
}

function formatSets(sets: readonly WorkoutSet[]): string {
  const count = `${formatNumber(sets.length)} ${sets.length === 1 ? "set" : "sets"}`;
  const firstReps = sets.find((set) => set.reps !== null)?.reps;
  if (firstReps === undefined || firstReps === null) {
    return count;
  }
  return `${count} of ${formatNumber(firstReps)} ${firstReps === 1 ? "rep" : "reps"}`;
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
  const sets = workingSets(exercise);

  if (exercise.top_set !== null) {
    parts.push(formatLoad(exercise.top_set, sets));
  }
  if (sets.length > 0) {
    parts.push(formatSets(sets));
  }

  const history = context.per_exercise[exercise.name];
  if (history !== undefined) {
    if (hasPrFlag(context.pr_flags, exercise.name)) {
      parts.push("PR");
    }
    if (history.volume_trend !== null) {
      parts.push(`volume trend ${history.volume_trend}`);
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
    `${formatNumber(summary.exercises.length)} exercises, ` +
      `${formatNumber(summary.total_volume)} total volume`,
  ];

  for (const exercise of summary.exercises) {
    lines.push(`${EXERCISE_BULLET} ${describeExercise(exercise, context)}`);
  }

  const body = truncate(
    lines.join("\n"),
    DESCRIPTION_MAX_LENGTH - DESCRIPTION_FOOTER.length,
  );
  const description = `${body}${DESCRIPTION_FOOTER}`;

  return { title, description };
}
