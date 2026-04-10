/**
 * Tests for the error mapping. The goal isn't to exhaustively cover string
 * content (those tests are brittle and we want flexibility to tune phrasing),
 * but to lock down:
 *
 *   1. Every known error code maps to SOME message (no fallthrough silently)
 *   2. The message contains the actionable next step we expect
 *      (e.g., the `unauthorized` message tells the agent to call signup)
 *   3. Numeric fields are formatted reasonably (minutes, attempts)
 *   4. Unknown codes don't crash — they fall through to the default branch
 *      with the raw message preserved
 *   5. The AdapterError exception class round-trips envelope fields correctly
 */
import { describe, expect, it } from 'vitest';
import { AdapterError, formatErrorForModel } from './errors.js';
import type { AdapterErrorEnvelope } from './types.js';

const envelope = (
  code: string,
  extras: Partial<AdapterErrorEnvelope['error']> = {},
): AdapterErrorEnvelope => ({
  error: {
    code,
    message: `default message for ${code}`,
    ...extras,
  },
});

describe('AdapterError', () => {
  it('exposes the code, message, and httpStatus from the envelope', () => {
    const err = new AdapterError(envelope('token_expired'), 401);
    expect(err.code).toBe('token_expired');
    expect(err.message).toBe('default message for token_expired');
    expect(err.httpStatus).toBe(401);
    expect(err.name).toBe('AdapterError');
    expect(err).toBeInstanceOf(Error);
  });

  it('exposes structured fields when present', () => {
    const env = envelope('code_invalid', {
      attempts_remaining: 2,
      retry_after_seconds: 600,
      request_id: 'req_xyz',
      trace_id: 'trace_abc',
      details: { foo: 'bar' },
      expires_at: '2026-04-15T22:32:39.436Z',
    });
    const err = new AdapterError(env, 400);
    expect(err.attemptsRemaining).toBe(2);
    expect(err.retryAfterSeconds).toBe(600);
    expect(err.requestId).toBe('req_xyz');
    expect(err.traceId).toBe('trace_abc');
    expect(err.details).toEqual({ foo: 'bar' });
    expect(err.expiresAt).toBe('2026-04-15T22:32:39.436Z');
  });

  it('defaults missing optional fields to undefined / null', () => {
    const err = new AdapterError(envelope('internal_error'), 500);
    expect(err.attemptsRemaining).toBeUndefined();
    expect(err.retryAfterSeconds).toBeUndefined();
    expect(err.requestId).toBeUndefined();
    expect(err.traceId).toBeUndefined();
    expect(err.details).toBeUndefined();
    expect(err.expiresAt).toBeNull();
  });
});

describe('formatErrorForModel', () => {
  it('returns a non-empty string for every known error code', () => {
    const codes = [
      'invalid_request',
      'missing_field',
      'invalid_email',
      'disposable_email',
      'code_invalid',
      'code_expired',
      'code_attempts_exceeded',
      'unauthorized',
      'token_expired',
      'tenant_suspended',
      'tenant_quota_exceeded',
      'global_quota_exceeded',
      'signup_rate_limited',
      'destination_not_found',
      'destination_ambiguous',
      'expedia_upstream_error',
      'upstream_timeout',
      'upstream_unavailable',
      'internal_error',
    ];
    for (const code of codes) {
      const msg = formatErrorForModel(new AdapterError(envelope(code), 400));
      expect(msg.length).toBeGreaterThan(20);
      expect(msg).not.toContain('undefined');
      expect(msg).not.toContain('NaN');
      expect(msg).not.toContain('[object Object]');
    }
  });

  describe('unauthorized → first-time setup', () => {
    it('tells the agent to call stayfinder_signup', () => {
      const msg = formatErrorForModel(new AdapterError(envelope('unauthorized'), 401));
      expect(msg).toMatch(/stayfinder_signup/);
      expect(msg).toMatch(/stayfinder_verify/);
      expect(msg).toMatch(/email/i);
    });
  });

  describe('token_expired → re-auth with cached email', () => {
    it('tells the agent NOT to ask for the email', () => {
      const msg = formatErrorForModel(new AdapterError(envelope('token_expired'), 401));
      expect(msg).toMatch(/stayfinder_signup/);
      // The "do NOT ask the user for their email" instruction is the
      // single most important thing in this message — without it the
      // agent's recovery flow would feel like a setup ritual instead
      // of a 30-second pause. Lock it down.
      expect(msg).toMatch(/do NOT ask|don'?t ask|cached/i);
    });
  });

  describe('code_invalid → attempts_remaining surfacing', () => {
    it('surfaces the attempts_remaining count when present', () => {
      const err = new AdapterError(
        envelope('code_invalid', { attempts_remaining: 2 }),
        400,
      );
      expect(formatErrorForModel(err)).toMatch(/2 attempts? left/);
    });

    it('uses "attempt" (singular) when attempts_remaining is 1', () => {
      const err = new AdapterError(
        envelope('code_invalid', { attempts_remaining: 1 }),
        400,
      );
      const msg = formatErrorForModel(err);
      expect(msg).toMatch(/1 attempt left/);
      expect(msg).not.toMatch(/1 attempts left/);
    });

    it('falls through to "request a new code" when attempts_remaining is missing', () => {
      const err = new AdapterError(envelope('code_invalid'), 400);
      const msg = formatErrorForModel(err);
      expect(msg).toMatch(/stayfinder_signup/);
      expect(msg).not.toMatch(/attempts? left/);
    });
  });

  describe('code_attempts_exceeded → fresh code', () => {
    it('tells the agent to call stayfinder_signup again', () => {
      const msg = formatErrorForModel(
        new AdapterError(envelope('code_attempts_exceeded'), 429),
      );
      expect(msg).toMatch(/stayfinder_signup/);
      expect(msg).toMatch(/locked/i);
    });
  });

  describe('rate-limit minutes formatting', () => {
    it('formats tenant_quota_exceeded retry_after_seconds as minutes', () => {
      const err = new AdapterError(
        envelope('tenant_quota_exceeded', { retry_after_seconds: 480 }),
        429,
      );
      const msg = formatErrorForModel(err);
      expect(msg).toMatch(/8 minutes/);
    });

    it('rounds up partial minutes', () => {
      const err = new AdapterError(
        envelope('tenant_quota_exceeded', { retry_after_seconds: 70 }),
        429,
      );
      const msg = formatErrorForModel(err);
      expect(msg).toMatch(/2 minutes/);
    });

    it('uses 1 minute as the floor for missing or weird values', () => {
      const err = new AdapterError(envelope('tenant_quota_exceeded'), 429);
      expect(formatErrorForModel(err)).toMatch(/1 minutes/);
    });
  });

  describe('destination_ambiguous → candidate list', () => {
    it('renders the candidates as a bulleted list when present', () => {
      const err = new AdapterError(
        envelope('destination_ambiguous', {
          details: {
            candidates: [
              { label: 'Springfield, Illinois' },
              { label: 'Springfield, Missouri' },
            ],
          },
        }),
        409,
      );
      const msg = formatErrorForModel(err);
      expect(msg).toMatch(/Springfield, Illinois/);
      expect(msg).toMatch(/Springfield, Missouri/);
      expect(msg).toMatch(/-/); // bullet
    });

    it('falls through gracefully when candidates is missing', () => {
      const err = new AdapterError(envelope('destination_ambiguous'), 409);
      expect(formatErrorForModel(err).length).toBeGreaterThan(20);
    });
  });

  describe('upstream errors include the trace id', () => {
    it('mentions the trace id when available', () => {
      const err = new AdapterError(
        envelope('expedia_upstream_error', { trace_id: 'trace_zzz' }),
        502,
      );
      expect(formatErrorForModel(err)).toMatch(/trace_zzz/);
    });

    it('falls back to request id if trace id is missing', () => {
      const err = new AdapterError(
        envelope('expedia_upstream_error', { request_id: 'req_qqq' }),
        502,
      );
      expect(formatErrorForModel(err)).toMatch(/req_qqq/);
    });

    it('shows a "no trace id" placeholder when both are missing', () => {
      const err = new AdapterError(envelope('expedia_upstream_error'), 502);
      expect(formatErrorForModel(err)).toMatch(/no trace id|trace:/);
    });
  });

  describe('unknown codes', () => {
    it('falls through to a default message that preserves the raw fields', () => {
      const err = new AdapterError(
        envelope('something_brand_new', {
          message: 'a brand new error nobody has seen yet',
        }),
        418,
      );
      const msg = formatErrorForModel(err);
      expect(msg).toMatch(/a brand new error nobody has seen yet/);
      expect(msg).toMatch(/something_brand_new/);
    });
  });
});
