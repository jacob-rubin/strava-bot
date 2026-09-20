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

/** Fastify's body-limit rejection is the one failure that arrives untyped. */
export function ingestFailure(error: unknown): IngestError {
  if (error instanceof IngestError) {
    return error;
  }
  const errorCode =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
  return errorCode === "FST_ERR_CTP_BODY_TOO_LARGE"
    ? new PayloadTooLargeError()
    : new InternalError();
}

export function stravaReason(error: unknown): string {
  if (error instanceof Error && error.message !== "") {
    return error.message.replace(/[\r\n]+/g, " ");
  }
  return "Strava request failed";
}
