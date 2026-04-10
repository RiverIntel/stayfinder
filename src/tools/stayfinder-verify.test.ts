import { describe, expect, it, vi } from 'vitest';

vi.mock('../adapter-client.js', async () => {
  const actual = await vi.importActual<typeof import('../adapter-client.js')>(
    '../adapter-client.js',
  );
  return { ...actual, AdapterClient: vi.fn() };
});
vi.mock('../credential-store.js', () => ({
  writeCredential: vi.fn(),
}));

import { AdapterClient } from '../adapter-client.js';
import { writeCredential } from '../credential-store.js';
import { AdapterError } from '../errors.js';
import { createStayFinderVerifyTool } from './stayfinder-verify.js';

const fakeApi = (overrides: Record<string, unknown> = {}) => ({
  id: 'stayfinder',
  name: 'StayFinder',
  version: '0.1.0',
  pluginConfig: { adapter_url: 'https://api.stayfinder.test' },
  ...overrides,
});

const mockVerify = (impl: () => Promise<unknown>): void => {
  const ctor = AdapterClient as unknown as ReturnType<typeof vi.fn>;
  ctor.mockImplementation(function (this: object) {
    Object.assign(this, { signupVerify: impl });
  });
};

const verifySuccessResponse = () => ({
  status: 'verified' as const,
  tenant_id: 'ten_TEST',
  token: 'oct_SECRET_TOKEN',
  token_kind: 'ephemeral' as const,
  expires_at: '2026-04-16T16:00:00Z',
  quota_per_hour: 50,
  default_pos: 'US',
});

describe('stayfinder_verify tool', () => {
  describe('shape', () => {
    it('exposes the right name, label, and parameters', () => {
      const tool = createStayFinderVerifyTool(fakeApi());
      expect(tool.name).toBe('stayfinder_verify');
      expect(tool.label).toBe('StayFinder Verify');
      expect(tool.description).toMatch(/6-digit/);
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('happy path', () => {
    it('exchanges the code for a token, writes credentials, and returns a success message', async () => {
      mockVerify(async () => verifySuccessResponse());
      vi.mocked(writeCredential).mockResolvedValueOnce(undefined);

      const tool = createStayFinderVerifyTool(fakeApi());
      const result = await tool.execute('c', {
        email: 'matt@example.com',
        code: '473829',
      });

      // Check the message
      expect(result.content[0].text).toMatch(/active/i);
      expect(result.content[0].text).toMatch(/50 searches/);
      expect(result.content[0].text).toMatch(/search_stays/);

      // Check that writeCredential was called with the right shape
      expect(writeCredential).toHaveBeenCalledOnce();
      const written = vi.mocked(writeCredential).mock.calls[0][0];
      expect(written.api_token).toBe('oct_SECRET_TOKEN');
      expect(written.tenant_id).toBe('ten_TEST');
      expect(written.email).toBe('matt@example.com');
      expect(written.token_kind).toBe('ephemeral');
      expect(written.expires_at).toBe('2026-04-16T16:00:00Z');

      // The token should NOT be in the returned message or details
      expect(result.content[0].text).not.toContain('oct_SECRET_TOKEN');
      expect(JSON.stringify(result.details)).not.toContain('oct_SECRET_TOKEN');
    });

    it('strips stray characters from the pasted code before sending', async () => {
      let capturedCode: string | undefined;
      const ctor = AdapterClient as unknown as ReturnType<typeof vi.fn>;
      ctor.mockImplementation(function (this: object) {
        Object.assign(this, {
          signupVerify: async (_email: string, code: string) => {
            capturedCode = code;
            return verifySuccessResponse();
          },
        });
      });
      vi.mocked(writeCredential).mockResolvedValueOnce(undefined);

      const tool = createStayFinderVerifyTool(fakeApi());
      await tool.execute('c', { email: 'matt@example.com', code: '  473-829  ' });
      expect(capturedCode).toBe('473829');
    });

    it('mentions the inactivity expiry for ephemeral tokens', async () => {
      mockVerify(async () => verifySuccessResponse());
      vi.mocked(writeCredential).mockResolvedValueOnce(undefined);

      const tool = createStayFinderVerifyTool(fakeApi());
      const result = await tool.execute('c', {
        email: 'matt@example.com',
        code: '473829',
      });
      expect(result.content[0].text).toMatch(/inactivity/i);
    });

    it('omits the inactivity note for persistent tokens', async () => {
      mockVerify(async () => ({
        ...verifySuccessResponse(),
        token_kind: 'persistent',
        expires_at: null,
      }));
      vi.mocked(writeCredential).mockResolvedValueOnce(undefined);

      const tool = createStayFinderVerifyTool(fakeApi());
      const result = await tool.execute('c', {
        email: 'matt@example.com',
        code: '473829',
      });
      expect(result.content[0].text).not.toMatch(/inactivity/i);
    });
  });

  describe('local validation', () => {
    it('throws on an empty email without calling the adapter', async () => {
      const tool = createStayFinderVerifyTool(fakeApi());
      await expect(tool.execute('c', { email: '', code: '123456' })).rejects.toThrow(
        /email/i,
      );
    });

    it('throws when the code is not 6 digits', async () => {
      const tool = createStayFinderVerifyTool(fakeApi());
      await expect(
        tool.execute('c', {
          email: 'matt@example.com',
          code: 'oct_long_token_pasted_by_mistake',
        }),
      ).rejects.toThrow(/6-digit code/i);
    });
  });

  describe('adapter error mapping', () => {
    it('maps code_invalid with attempts_remaining', async () => {
      mockVerify(async () => {
        throw new AdapterError(
          { error: { code: 'code_invalid', message: 'wrong', attempts_remaining: 2 } },
          400,
        );
      });
      const tool = createStayFinderVerifyTool(fakeApi());
      await expect(
        tool.execute('c', { email: 'matt@example.com', code: '000000' }),
      ).rejects.toThrow(/2 attempts left/);
    });

    it('maps code_expired', async () => {
      mockVerify(async () => {
        throw new AdapterError(
          { error: { code: 'code_expired', message: 'expired' } },
          400,
        );
      });
      const tool = createStayFinderVerifyTool(fakeApi());
      await expect(
        tool.execute('c', { email: 'matt@example.com', code: '000000' }),
      ).rejects.toThrow(/expired/i);
    });

    it('maps code_attempts_exceeded', async () => {
      mockVerify(async () => {
        throw new AdapterError(
          { error: { code: 'code_attempts_exceeded', message: 'locked' } },
          429,
        );
      });
      const tool = createStayFinderVerifyTool(fakeApi());
      await expect(
        tool.execute('c', { email: 'matt@example.com', code: '000000' }),
      ).rejects.toThrow(/locked|too many/i);
    });
  });

  describe('credential write failure', () => {
    it('throws a clear message if writeCredential fails', async () => {
      mockVerify(async () => verifySuccessResponse());
      vi.mocked(writeCredential).mockRejectedValueOnce(
        new Error('EACCES permission denied'),
      );

      const tool = createStayFinderVerifyTool(fakeApi());
      await expect(
        tool.execute('c', { email: 'matt@example.com', code: '473829' }),
      ).rejects.toThrow(/failed to save|EACCES/i);
    });
  });
});
