/**
 * Tests for the stayfinder_signup tool. Mocks the adapter client at the
 * module boundary so the tests are pure and don't touch the network.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../adapter-client.js', async () => {
  const actual = await vi.importActual<typeof import('../adapter-client.js')>(
    '../adapter-client.js',
  );
  return {
    ...actual,
    AdapterClient: vi.fn(),
  };
});

import { AdapterClient } from '../adapter-client.js';
import { AdapterError } from '../errors.js';
import { createStayFinderSignupTool } from './stayfinder-signup.js';

const fakeApi = (overrides: Record<string, unknown> = {}) => ({
  id: 'stayfinder',
  name: 'StayFinder',
  version: '0.1.0',
  pluginConfig: { adapter_url: 'https://api.stayfinder.test' },
  ...overrides,
});

const mockSignup = (impl: () => Promise<unknown>): void => {
  // vi.mocked(...).mockImplementation only works for plain functions, but
  // AdapterClient is invoked via `new`. Cast to a constructable shim that
  // returns an object with a `signup` method.
  const ctor = AdapterClient as unknown as ReturnType<typeof vi.fn>;
  ctor.mockImplementation(function (this: object) {
    Object.assign(this, { signup: impl });
  });
};

describe('stayfinder_signup tool', () => {
  describe('shape', () => {
    it('exposes the right name, label, and parameters', () => {
      const tool = createStayFinderSignupTool(fakeApi());
      expect(tool.name).toBe('stayfinder_signup');
      expect(tool.label).toBe('StayFinder Signup');
      expect(tool.description).toMatch(/6-digit/);
      expect(tool.description).toMatch(/token_expired/);
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('happy path', () => {
    it('calls AdapterClient.signup with the trimmed email and returns a friendly message', async () => {
      mockSignup(async () => ({
        status: 'verification_sent' as const,
        message: '...',
        expires_in_seconds: 900,
      }));

      const tool = createStayFinderSignupTool(fakeApi());
      const result = await tool.execute('call_1', { email: '  matt@example.com  ' });

      expect(result.content[0].text).toMatch(/matt@example.com/);
      expect(result.content[0].text).toMatch(/15 minutes/);
      expect(result.content[0].text).toMatch(/stayfinder_verify/);
      expect(result.details).toEqual({
        status: 'verification_sent',
        email: 'matt@example.com',
        expires_in_seconds: 900,
      });
    });

    it('formats expires_in_seconds as minutes correctly', async () => {
      mockSignup(async () => ({
        status: 'verification_sent' as const,
        message: '...',
        expires_in_seconds: 600, // 10 minutes
      }));
      const tool = createStayFinderSignupTool(fakeApi());
      const result = await tool.execute('call_1', { email: 'matt@example.com' });
      expect(result.content[0].text).toMatch(/10 minutes/);
    });
  });

  describe('local email validation', () => {
    it('throws on an empty email without calling the adapter', async () => {
      mockSignup(async () => {
        throw new Error('should not be called');
      });
      const tool = createStayFinderSignupTool(fakeApi());
      await expect(tool.execute('c', { email: '' })).rejects.toThrow(/empty/i);
    });

    it('throws on a syntactically invalid email without calling the adapter', async () => {
      mockSignup(async () => {
        throw new Error('should not be called');
      });
      const tool = createStayFinderSignupTool(fakeApi());
      await expect(tool.execute('c', { email: 'not-an-email' })).rejects.toThrow(
        /doesn't look like a valid email/i,
      );
    });

    it('throws when email is missing entirely', async () => {
      mockSignup(async () => {
        throw new Error('should not be called');
      });
      const tool = createStayFinderSignupTool(fakeApi());
      await expect(tool.execute('c', {})).rejects.toThrow();
    });
  });

  describe('error mapping', () => {
    it('maps disposable_email through formatErrorForModel', async () => {
      mockSignup(async () => {
        throw new AdapterError(
          { error: { code: 'disposable_email', message: 'no go' } },
          400,
        );
      });
      const tool = createStayFinderSignupTool(fakeApi());
      await expect(
        tool.execute('c', { email: 'temp@mailinator.com' }),
      ).rejects.toThrow(/disposable-email blocklist|disposable/i);
    });

    it('maps signup_rate_limited with retry minutes', async () => {
      mockSignup(async () => {
        throw new AdapterError(
          {
            error: {
              code: 'signup_rate_limited',
              message: 'too many',
              retry_after_seconds: 3600,
            },
          },
          429,
        );
      });
      const tool = createStayFinderSignupTool(fakeApi());
      await expect(tool.execute('c', { email: 'matt@example.com' })).rejects.toThrow(
        /60 minutes/,
      );
    });

    it('passes through non-AdapterError errors as-is (network, timeout)', async () => {
      mockSignup(async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:8080');
      });
      const tool = createStayFinderSignupTool(fakeApi());
      await expect(tool.execute('c', { email: 'matt@example.com' })).rejects.toThrow(
        /ECONNREFUSED/,
      );
    });
  });
});
