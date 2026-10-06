// The Worker's own error bodies (NK's error envelopes, e.g. "No Scores Available", pass through unchanged).
//
//   { "success": false, "error": "<short message a page can show as is>", "code": "<machine-readable>" }
//
// `error` is written for visitors, not developers; the status code and `code` carry the meaning. 429s also
// carry `retryAfter` (seconds), mirrored in the Retry-After header.

export type ErrorCode =
  | "not_found"
  | "private"
  | "bad_request"
  | "rate_limited"
  | "upstream"
  | "unavailable"
  | "method_not_allowed"
  | "internal";

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  not_found: "Not found",
  private: "This data is private",
  bad_request: "Invalid request",
  rate_limited: "Too many requests, try again shortly",
  upstream: "Ninja Kiwi's servers aren't responding",
  unavailable: "Temporarily unavailable",
  method_not_allowed: "Method not allowed",
  internal: "Something went wrong",
};

export function errorBody(code: ErrorCode, message: string = ERROR_MESSAGES[code], extra?: Record<string, unknown>): string {
  return JSON.stringify({ success: false, error: message, code, ...extra });
}
