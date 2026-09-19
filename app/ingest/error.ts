export abstract class IngestError extends Error {
  abstract readonly statusCode: number;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class PayloadTooLargeError extends IngestError {
  readonly statusCode = 413;

  constructor() {
    super("payload too large");
  }
}

export class UnparseableWorkoutError extends IngestError {
  readonly statusCode = 400;

  constructor() {
    super("not a Strong workout");
  }
}

export class StravaRejectedError extends IngestError {
  readonly statusCode = 502;

  constructor(error: unknown) {
    super(`strava rejected: ${stravaReason(error)}`);
  }
}

export class InternalError extends IngestError {
  readonly statusCode = 500;

  constructor() {
    super("internal error");
  }
}

export function stravaReason(error: unknown): string {
  if (error instanceof Error && error.message !== "") {
    return error.message.replace(/[\r\n]+/g, " ");
  }
  return "Strava request failed";
}
