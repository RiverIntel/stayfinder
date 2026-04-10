/**
 * Tests for pre-HTTP validation. The functions in validation.ts are pure;
 * tests pass a `now` parameter to validateSearchStaysRequest so they don't
 * depend on the wall clock.
 */
import { describe, expect, it } from 'vitest';
import {
  sanitizeAndValidateCode,
  validateEmailLoose,
  validateSearchStaysRequest,
} from './validation.js';
import type { SearchStaysRequest } from './types.js';

const NOW = new Date('2026-04-09T00:00:00Z');

const baseReq = (overrides: Partial<SearchStaysRequest> = {}): SearchStaysRequest => ({
  destination: 'Manhattan Lower East Side',
  check_in: '2026-05-01',
  check_out: '2026-05-04',
  adults: 2,
  ...overrides,
});

describe('validateSearchStaysRequest', () => {
  describe('happy path', () => {
    it('returns null for a valid request', () => {
      expect(validateSearchStaysRequest(baseReq(), NOW)).toBeNull();
    });

    it('accepts the boundary case: check_in == today', () => {
      expect(
        validateSearchStaysRequest(
          baseReq({ check_in: '2026-04-09', check_out: '2026-04-12' }),
          NOW,
        ),
      ).toBeNull();
    });

    it('accepts a stay of exactly 30 nights', () => {
      expect(
        validateSearchStaysRequest(
          baseReq({ check_in: '2026-05-01', check_out: '2026-05-31' }),
          NOW,
        ),
      ).toBeNull();
    });

    it('accepts check_in exactly 500 days out', () => {
      // 2026-04-09 + 500 days = 2027-08-22
      expect(
        validateSearchStaysRequest(
          baseReq({ check_in: '2027-08-22', check_out: '2027-08-25' }),
          NOW,
        ),
      ).toBeNull();
    });
  });

  describe('date format', () => {
    it.each([
      ['not-a-date'],
      ['2026/05/01'],
      ['05-01-2026'],
      ['2026-5-1'],
      [''],
    ])('rejects malformed check_in: %j', (check_in) => {
      const result = validateSearchStaysRequest(baseReq({ check_in }), NOW);
      expect(result).not.toBeNull();
      expect(result).toMatch(/check_in/);
    });

    it('rejects an impossible date that Date.parse would silently roll over', () => {
      // Feb 30 → March 2; we want to catch this as invalid, not accept it
      const result = validateSearchStaysRequest(
        baseReq({ check_in: '2026-02-30' }),
        NOW,
      );
      expect(result).not.toBeNull();
      expect(result).toMatch(/check_in/);
    });
  });

  describe('date order', () => {
    it('rejects check_out before check_in', () => {
      const result = validateSearchStaysRequest(
        baseReq({ check_in: '2026-05-04', check_out: '2026-05-01' }),
        NOW,
      );
      expect(result).not.toBeNull();
      expect(result).toMatch(/swap the dates/i);
    });

    it('rejects check_out equal to check_in', () => {
      const result = validateSearchStaysRequest(
        baseReq({ check_in: '2026-05-01', check_out: '2026-05-01' }),
        NOW,
      );
      expect(result).not.toBeNull();
      expect(result).toMatch(/check_out/);
    });
  });

  describe('check_in not in past', () => {
    it('rejects yesterday', () => {
      const result = validateSearchStaysRequest(
        baseReq({ check_in: '2026-04-08', check_out: '2026-04-12' }),
        NOW,
      );
      expect(result).not.toBeNull();
      expect(result).toMatch(/past/i);
    });
  });

  describe('stay length', () => {
    it('rejects 31 nights', () => {
      const result = validateSearchStaysRequest(
        baseReq({ check_in: '2026-05-01', check_out: '2026-06-01' }),
        NOW,
      );
      expect(result).not.toBeNull();
      expect(result).toMatch(/31 nights/);
      expect(result).toMatch(/30-night/);
    });
  });

  describe('500-day window', () => {
    it('rejects check_in 501 days out', () => {
      // 2026-04-09 + 501 days = 2027-08-23
      const result = validateSearchStaysRequest(
        baseReq({ check_in: '2027-08-23', check_out: '2027-08-26' }),
        NOW,
      );
      expect(result).not.toBeNull();
      expect(result).toMatch(/501 days/);
    });
  });

  describe('filter sanity', () => {
    it('rejects inverted star_rating range', () => {
      const result = validateSearchStaysRequest(
        baseReq({ filters: { min_star_rating: 5, max_star_rating: 3 } }),
        NOW,
      );
      expect(result).not.toBeNull();
      expect(result).toMatch(/star/i);
      expect(result).toMatch(/swap/i);
    });

    it('accepts equal star_rating bounds', () => {
      expect(
        validateSearchStaysRequest(
          baseReq({ filters: { min_star_rating: 4, max_star_rating: 4 } }),
          NOW,
        ),
      ).toBeNull();
    });

    it('rejects inverted price range', () => {
      const result = validateSearchStaysRequest(
        baseReq({ filters: { price_min: 500, price_max: 200 } }),
        NOW,
      );
      expect(result).not.toBeNull();
      expect(result).toMatch(/price/i);
    });

    it('does NOT reject when only one bound is set', () => {
      expect(
        validateSearchStaysRequest(baseReq({ filters: { price_min: 100 } }), NOW),
      ).toBeNull();
      expect(
        validateSearchStaysRequest(baseReq({ filters: { price_max: 500 } }), NOW),
      ).toBeNull();
    });
  });
});

describe('validateEmailLoose', () => {
  it.each([
    ['matt@example.com'],
    ['user.name+tag@sub.example.org'],
    ['  matt@example.com  '],
    ['a@b.co'],
  ])('accepts %j', (input) => {
    expect(validateEmailLoose(input)).toBeNull();
  });

  it.each([
    [''],
    ['no-at-sign'],
    ['matt@'],
    ['@example.com'],
    ['matt@example'],
    ['has space@example.com'],
    ['x'.repeat(255) + '@example.com'],
  ])('rejects %j', (input) => {
    expect(validateEmailLoose(input)).not.toBeNull();
  });

  it('rejects non-strings without throwing', () => {
    expect(validateEmailLoose(undefined as unknown as string)).not.toBeNull();
    expect(validateEmailLoose(null as unknown as string)).not.toBeNull();
    expect(validateEmailLoose(42 as unknown as string)).not.toBeNull();
  });
});

describe('sanitizeAndValidateCode', () => {
  it.each([
    ['473829', '473829'],
    [' 473829 ', '473829'],
    ['473-829', '473829'],
    ['473 829', '473829'],
    ['473\u00a0829', '473829'],
    ['000000', '000000'],
    ['999999', '999999'],
  ])('accepts %j → %j', (input, expected) => {
    expect(sanitizeAndValidateCode(input)).toBe(expected);
  });

  it.each([
    ['12345'],
    ['1234567'],
    [''],
    ['abcdef'],
    ['oct_long_token_pasted_by_mistake'],
  ])('rejects %j', (input) => {
    expect(sanitizeAndValidateCode(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(sanitizeAndValidateCode(undefined)).toBeNull();
    expect(sanitizeAndValidateCode(null)).toBeNull();
    expect(sanitizeAndValidateCode(123456)).toBeNull();
  });
});
