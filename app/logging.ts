export interface RequestLog {
  status: number;
  /**
   * The shared payload, present only when DEBUG_LOG_RAW_TEXT is enabled. Never a
   * secret, and never set for an auth failure — §11 allows that case no request data.
   */
  raw_text?: string;
}

export function logRequest(record: RequestLog): void {
  console.log(JSON.stringify(record));
}
