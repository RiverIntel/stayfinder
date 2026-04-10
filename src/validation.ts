/**
 * Pre-HTTP validation for `search_stays` parameters.
 *
 * The TypeBox schema in `tools/search-stays.ts` catches type and range
 * errors that the runtime can enforce automatically (string vs number,
 * minLength, maximum, enum membership, etc.). Anything that requires
 * cross-field comparison or runtime computation lives here.
 *
 * Returning a non-null string from any of these functions means the
 * tool's `execute` should throw with that string as the user-facing
 * message instead of making the HTTP call. The string is phrased for
 * the model — concrete next action, plain English, no error codes.
 *
 * The spec is explicit that error messages should give the model an
 * actionable hypothesis. "check_out must be after check_in. Did you
 * swap the dates?" is much better than "validation failed".
 */

import type { SearchStaysRequest } from './types.js';

const MAX_NIGHTS = 30;
const MAX_DAYS_OUT = 500;

const ymdRegex = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a YYYY-MM-DD string as UTC midnight. Returns null if the string
 * doesn't match the format or doesn't represent a real date.
 *
 * We use UTC because the adapter (and Expedia) treat the date as
 * calendar-day-in-the-destination, not "wall clock at midnight in the
 * user's local timezone". A user in NYC searching for a hotel in Tokyo
 * for 2026-06-01 means 2026-06-01 in Tokyo, regardless of what time it
 * is on their laptop.
 */
const parseYmdUtc = (s: string): Date | null => {
  if (!ymdRegex.test(s)) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  // Reject roll-overs like "2026-02-30" — Date.parse silently rolls them
  // forward, so we round-trip and compare to catch the difference.
  const back = new Date(ms).toISOString().slice(0, 10);
  if (back !== s) return null;
  return new Date(ms);
};

/** Today, normalized to UTC midnight, as a Date. */
const todayUtc = (): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const daysBetween = (a: Date, b: Date): number => {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
};

/**
 * Run all post-schema validation checks against a `search_stays` request.
 *
 * Returns null if everything passes; otherwise returns the model-facing
 * error message string. Tools call this in `execute` *before* hitting
 * the HTTP layer so we never burn an adapter call on a request the
 * adapter would also reject.
 */
export function validateSearchStaysRequest(
  req: SearchStaysRequest,
  now: Date = todayUtc(),
): string | null {
  // -----------------------------------------------------------------------
  // Date format
  // -----------------------------------------------------------------------
  const checkIn = parseYmdUtc(req.check_in);
  if (!checkIn) {
    return (
      `check_in is not a valid YYYY-MM-DD date: "${req.check_in}". ` +
      'Ask the user for the date in plain English and re-format it as YYYY-MM-DD.'
    );
  }
  const checkOut = parseYmdUtc(req.check_out);
  if (!checkOut) {
    return (
      `check_out is not a valid YYYY-MM-DD date: "${req.check_out}". ` +
      'Ask the user for the date in plain English and re-format it as YYYY-MM-DD.'
    );
  }

  // -----------------------------------------------------------------------
  // Date order — by far the most common LLM mistake
  // -----------------------------------------------------------------------
  if (checkOut.getTime() <= checkIn.getTime()) {
    return (
      `check_out (${req.check_out}) must be after check_in (${req.check_in}). ` +
      'Did you swap the dates? Re-check with the user and call search_stays again.'
    );
  }

  // -----------------------------------------------------------------------
  // check_in not in the past
  // -----------------------------------------------------------------------
  if (checkIn.getTime() < now.getTime()) {
    return (
      `check_in (${req.check_in}) is in the past. ` +
      'Confirm the dates with the user — Expedia only sells future stays.'
    );
  }

  // -----------------------------------------------------------------------
  // Stay length cap
  // -----------------------------------------------------------------------
  const nights = daysBetween(checkIn, checkOut);
  if (nights > MAX_NIGHTS) {
    return (
      `Stay length is ${nights} nights, which exceeds the ${MAX_NIGHTS}-night maximum per search. ` +
      'Split the trip into multiple ≤30-night searches and combine the results yourself.'
    );
  }

  // -----------------------------------------------------------------------
  // check_in window cap (Expedia only quotes ~500 days out)
  // -----------------------------------------------------------------------
  const daysOut = daysBetween(now, checkIn);
  if (daysOut > MAX_DAYS_OUT) {
    return (
      `check_in (${req.check_in}) is ${daysOut} days from now, beyond the ${MAX_DAYS_OUT}-day booking window. ` +
      'Tell the user the destination doesn\'t have inventory open that far in the future yet, and ask if they want to try a date closer to now.'
    );
  }

  // -----------------------------------------------------------------------
  // Filter sanity (only when both ends of a range are present)
  // -----------------------------------------------------------------------
  const filters = req.filters;
  if (filters) {
    if (
      typeof filters.min_star_rating === 'number' &&
      typeof filters.max_star_rating === 'number' &&
      filters.min_star_rating > filters.max_star_rating
    ) {
      return (
        `Star rating filter is inverted: min_star_rating ${filters.min_star_rating} > max_star_rating ${filters.max_star_rating}. ` +
        'Did you swap them? Re-call search_stays with the bounds in the right order.'
      );
    }
    if (
      typeof filters.price_min === 'number' &&
      typeof filters.price_max === 'number' &&
      filters.price_min > filters.price_max
    ) {
      return (
        `Price filter is inverted: price_min ${filters.price_min} > price_max ${filters.price_max}. ` +
        'Did you swap them? Re-call search_stays with the bounds in the right order.'
      );
    }
  }

  return null;
}

/**
 * Trim and validate an email address with a deliberately-loose check.
 *
 * The plugin doesn't try to be a perfect RFC 5322 validator — that's the
 * adapter's job (it uses the same `email-validator` package and runs the
 * disposable-domain check). All we want here is to reject things that
 * obviously aren't emails before burning an HTTP call.
 *
 * Returns null on success, or a model-facing error string on failure.
 */
export function validateEmailLoose(raw: string): string | null {
  if (typeof raw !== 'string') {
    return 'Email must be a string. Ask the user for their email address.';
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return 'Email is empty. Ask the user for their email address.';
  }
  if (trimmed.length > 254) {
    return 'Email is unrealistically long. Ask the user to double-check what they typed.';
  }
  // One @, non-empty local and domain parts, domain has at least one dot,
  // no whitespace anywhere. This matches the adapter's first-pass regex.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return (
      `"${trimmed}" doesn't look like a valid email address. ` +
      'Ask the user to double-check the spelling.'
    );
  }
  return null;
}

/**
 * Strip whitespace, dashes, dots, and any non-digit characters from a
 * pasted code, then return the result if it's exactly 6 ASCII digits.
 *
 * Returns null when the cleaned input isn't 6 digits — the verify tool
 * uses this to short-circuit "the user pasted a token by mistake" or
 * "the user pasted a phrase" without burning an HTTP call.
 *
 * Defensive cleanup matters because email clients sometimes paste
 * non-breaking spaces or thin spaces around copied text.
 */
export function sanitizeAndValidateCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^0-9]/g, '');
  if (cleaned.length !== 6) return null;
  return cleaned;
}
