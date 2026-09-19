/** Captures a thrown failure as a value, so a caller can branch on it with `const`. */

export type Attempt<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

export async function attempt<T>(
  operation: () => Promise<T>,
): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}

export function attemptSync<T>(operation: () => T): Attempt<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error: unknown) {
    return { ok: false, error };
  }
}

