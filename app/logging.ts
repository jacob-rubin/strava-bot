export interface RequestLog {
  status: number;
  /**
   * The shared payload, present on every logged ingest request except an auth
   * failure — docs/reference/ingest-api.md allows that case no request data. Never a secret.
   */
  raw_text?: string;
}

export function logRequest(record: RequestLog): void {
  console.log(JSON.stringify(record));
}
