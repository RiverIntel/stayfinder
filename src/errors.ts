/**
 * Adapter error mapping.
 *
 * The plugin's three tools all talk to the StayFinder service, which
 * returns a structured error envelope (see types.ts AdapterErrorEnvelope)
 * for any non-2xx response. We translate that envelope into:
 *
 *   1. An `AdapterError` exception that the tool's `execute` function
 *      throws — the OpenClaw runtime catches the throw and surfaces it
 *      as a tool error to the model.
 *
 *   2. A short, model-facing message string that explains what happened
 *      in plain English with an actionable next step. Models react much
 *      better to "your access expired — call stayfinder_signup with the
 *      cached email" than to "HTTP 401 token_expired".
 *
 * The message text is the most important thing in the file. It's what
 * the agent reads when deciding what to tell the user, and it's where
 * we encode the recovery flows for `unauthorized` / `token_expired` /
 * `code_attempts_exceeded` etc.
 */

import type { AdapterErrorEnvelope } from './types.js';

// ---------------------------------------------------------------------------
// Exception class
// ---------------------------------------------------------------------------

/**
 * Thrown by adapter-client.ts when the StayFinder service returns a non-2xx
 * response. The constructor pulls fields out of the standard error envelope.
 *
 * Tool `execute` functions catch this, format the message, and re-throw a
 * new Error with the formatted text — the OpenClaw runtime then surfaces
 * the throw to the model. The structured fields stay accessible via the
 * `code`, `retryAfterSeconds`, etc. properties for tools that need to
 * branch on them (e.g., search-stays.ts treats `token_expired` differently
 * from `unauthorized`).
 */
export class AdapterError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly retryAfterSeconds?: number;
  readonly attemptsRemaining?: number;
  readonly expiresAt?: string | null;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly details?: Record<string, unknown>;

  constructor(envelope: AdapterErrorEnvelope, httpStatus: number) {
    super(envelope.error.message);
    this.name = 'AdapterError';
    this.code = envelope.error.code;
    this.httpStatus = httpStatus;
    this.retryAfterSeconds = envelope.error.retry_after_seconds;
    this.attemptsRemaining = envelope.error.attempts_remaining;
    this.expiresAt = envelope.error.expires_at ?? null;
    this.requestId = envelope.error.request_id;
    this.traceId = envelope.error.trace_id;
    this.details = envelope.error.details;
  }
}

// ---------------------------------------------------------------------------
// Model-facing message formatting
// ---------------------------------------------------------------------------

const minutesFromSeconds = (s: number | undefined): number => {
  if (s === undefined || !Number.isFinite(s) || s <= 0) return 1;
  return Math.max(1, Math.ceil(s / 60));
};

/**
 * Format an AdapterError as a single-string message the model can read.
 *
 * Each branch is hand-tuned for what the agent should DO with the error,
 * not just what went wrong. We tell the model the next concrete action
 * ("call stayfinder_signup with the cached email", "ask the user for a
 * different email", "wait N minutes and retry") rather than leaving it
 * to figure out the recovery flow on its own.
 */
export function formatErrorForModel(err: AdapterError): string {
  switch (err.code) {
    // Auth + setup
    case 'unauthorized':
      return (
        'StayFinder access is not configured yet. ' +
        'Run the first-time setup flow: ask the user for their email, ' +
        'call stayfinder_signup with it, then call stayfinder_verify with the 6-digit code they receive.'
      );

    case 'token_expired':
      return (
        'StayFinder access expired from inactivity (the token slides off after ~7 days unused). ' +
        'Re-run the signup flow: call stayfinder_signup with the user\'s email — ' +
        'do NOT ask the user for their email, it is available from the cached credential record. ' +
        'Then call stayfinder_verify with the new 6-digit code they receive.'
      );

    case 'tenant_suspended':
      return (
        'This StayFinder account has been suspended. ' +
        'You\'ll need to contact the operator to find out why; this is not something the user can fix from the chat.'
      );

    // Signup + verify error codes
    case 'invalid_email':
      return (
        'That doesn\'t look like a valid email address. ' +
        'Ask the user to double-check the spelling and try again.'
      );

    case 'disposable_email':
      return (
        'That email provider isn\'t accepted (it\'s on the disposable-email blocklist). ' +
        'Ask the user to use a different email address — gmail, fastmail, icloud, or any other regular provider.'
      );

    case 'signup_rate_limited':
      return (
        'Too many signup attempts. ' +
        `Try again in about ${minutesFromSeconds(err.retryAfterSeconds)} minutes, or use a different email address.`
      );

    case 'code_invalid': {
      const remaining = err.attemptsRemaining;
      if (typeof remaining === 'number' && remaining > 0) {
        return (
          `That code didn't match. You have ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} left. ` +
          'Ask the user to double-check the email — it\'s a 6-digit number from StayFinder.'
        );
      }
      // No attempts_remaining means there was no active pending row at all
      // (for example, the user already verified an earlier code, or signup was
      // never called). Fall through to "request a new one".
      return (
        'That code didn\'t match. ' +
        'Call stayfinder_signup again to send a fresh code to the user\'s email.'
      );
    }

    case 'code_expired':
      return (
        'That code expired (codes are only valid for 15 minutes). ' +
        'Call stayfinder_signup again to send a fresh code to the user\'s email.'
      );

    case 'code_attempts_exceeded':
      return (
        'Too many wrong attempts on that code — it\'s now locked. ' +
        'Call stayfinder_signup again to send a fresh code to the user\'s email.'
      );

    // Search-stays operational errors
    case 'tenant_quota_exceeded':
      return (
        `StayFinder hourly search limit reached. ` +
        `Try again in about ${minutesFromSeconds(err.retryAfterSeconds)} minutes. ` +
        'Tell the user honestly — do not fall back to web_search or browser; those won\'t give live pricing.'
      );

    case 'global_quota_exceeded':
      return (
        'The shared StayFinder rate limit is exhausted across all users right now. ' +
        `Try again in about ${minutesFromSeconds(err.retryAfterSeconds)} minutes. ` +
        'This is operator-side, not the user\'s personal quota.'
      );

    case 'destination_not_found':
      return (
        `Couldn't find that destination: "${err.message}". ` +
        'Ask the user to be more specific (city + state, or neighborhood + city), or suggest a nearby major city.'
      );

    case 'destination_ambiguous': {
      const candidates = (err.details?.candidates as Array<{ label: string }> | undefined) ?? [];
      if (candidates.length > 0) {
        const list = candidates.map((c) => `- ${c.label}`).join('\n');
        return `Multiple destinations match. Ask the user which one they meant:\n${list}`;
      }
      return 'That destination matched multiple places. Ask the user to be more specific.';
    }

    case 'expedia_upstream_error':
    case 'upstream_timeout':
      return (
        'The lodging service is having upstream trouble right now. ' +
        'Tell the user briefly and offer to retry in a minute. ' +
        `(trace: ${err.traceId ?? err.requestId ?? 'no trace id'})`
      );

    case 'upstream_unavailable':
      return (
        'The lodging service is temporarily shedding load (circuit breaker is open). ' +
        `Wait about ${err.retryAfterSeconds ?? 30} seconds and try again. ` +
        'Tell the user honestly — this is a brief outage, not a permanent failure.'
      );

    case 'invalid_request':
    case 'missing_field':
      return (
        `Search request was rejected by validation: ${err.message}. ` +
        'Re-read the error message; usually a date or filter problem. Fix and retry.'
      );

    case 'internal_error':
      return (
        'An internal error happened in the lodging service. ' +
        `Tell the user briefly and offer to retry. (trace: ${err.traceId ?? err.requestId ?? 'no trace id'})`
      );

    default:
      // Unknown code — surface the raw message + code so we have something
      // to grep for if it shows up in a session trace.
      return `StayFinder error: ${err.message} (code: ${err.code})`;
  }
}
