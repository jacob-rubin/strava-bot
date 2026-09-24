import rawExerciseTypeMap from "./exercise_type_map.json" with { type: "json" };

/** docs/reference/strava.md: the reserved key carrying the null-equipment value. */
const DEFAULT_EQUIPMENT_KEY = "default";

/** Sent when the map does not cover a name; the description still names the exercise. */
export const UNMAPPED_EXERCISE_TYPE = "TOTAL_BODY_GENERIC";

export interface ResolvedExerciseType {
  readonly exercise_type: string;
  readonly mapped: boolean;
}

type ExerciseTypeMap = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

const EXERCISE_TYPE_MAP: ExerciseTypeMap = rawExerciseTypeMap;

export function resolveExerciseType(
  name: string,
  equipment: string | null,
): ResolvedExerciseType {
  const byEquipment = EXERCISE_TYPE_MAP[name.trim()];
  if (byEquipment === undefined) {
    return { exercise_type: UNMAPPED_EXERCISE_TYPE, mapped: false };
  }

  const exact = equipment === null ? undefined : byEquipment[equipment.trim()];
  const resolved = exact ?? byEquipment[DEFAULT_EQUIPMENT_KEY];
  if (resolved === undefined) {
    return { exercise_type: UNMAPPED_EXERCISE_TYPE, mapped: false };
  }
  return { exercise_type: resolved, mapped: true };
}
