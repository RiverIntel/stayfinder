import { describe, expect, it, vi } from 'vitest';

vi.mock('../adapter-client.js', async () => {
  const actual = await vi.importActual<typeof import('../adapter-client.js')>(
    '../adapter-client.js',
  );
  return { ...actual, AdapterClient: vi.fn() };
});
vi.mock('../credential-store.js', () => ({
  readCredential: vi.fn(),
}));

import { AdapterClient } from '../adapter-client.js';
import { readCredential } from '../credential-store.js';
import { AdapterError } from '../errors.js';
import { createSearchStaysTool } from './search-stays.js';
import type { CredentialFile, SearchStaysResponse } from '../types.js';

const fakeApi = (overrides: Record<string, unknown> = {}) => ({
  id: 'stayfinder',
  name: 'StayFinder',
  version: '0.1.0',
  pluginConfig: { adapter_url: 'https://api.stayfinder.test' },
  ...overrides,
});

const sampleCredential = (): CredentialFile => ({
  api_token: 'oct_test_TOKEN',
  saved_at: '2026-04-09T16:00:00Z',
  tenant_id: 'ten_TEST',
  email: 'matt@example.com',
  token_kind: 'ephemeral',
  expires_at: '2026-04-16T16:00:00Z',
});

const sampleResponse = (): SearchStaysResponse => ({
  request_id: 'req_abc',
  cached: false,
  cached_at: '2026-04-09T16:00:00Z',
  cache_ttl_seconds: 1200,
  check_in: '2026-05-01',
  check_out: '2026-05-04',
  nights: 3,
  party: { adults: 2, children: 0 },
  currency: 'USD',
  result_count: 1,
  warnings: [],
  results: [
    {
      property_id: 'p1',
      name: '<<<EXTERNAL_UNTRUSTED_CONTENT id="a1">>>The Ludlow<<<END_EXTERNAL_UNTRUSTED_CONTENT id="a1">>>',
      star_rating: 4,
      price: {
        amount_per_night: 425,
        amount_total: 1275,
        currency: 'USD',
        taxes_included: false,
      },
      redirect_link: 'https://expedia.com/r/test',
    },
  ],
});

const mockSearch = (impl: () => Promise<unknown>): void => {
  const ctor = AdapterClient as unknown as ReturnType<typeof vi.fn>;
  ctor.mockImplementation(function (this: object) {
    Object.assign(this, { searchStays: impl });
  });
};

const validParams = () => ({
  destination: 'Manhattan Lower East Side',
  check_in: '2026-05-01',
  check_out: '2026-05-04',
  adults: 2,
});

describe('search_stays tool', () => {
  describe('shape', () => {
    it('exposes the right name, label, description, and parameters', () => {
      const tool = createSearchStaysTool(fakeApi());
      expect(tool.name).toBe('search_stays');
      expect(tool.label).toBe('StayFinder Search');
      expect(tool.description).toMatch(/DO NOT use web_search/);
      expect(tool.description).toMatch(/redirect/);
      expect(tool.parameters).toBeDefined();
    });
  });

  describe('no credentials → unauthorized', () => {
    it('throws with the "setup" message when no credential file exists', async () => {
      vi.mocked(readCredential).mockResolvedValueOnce(null);
      const tool = createSearchStaysTool(fakeApi());
      await expect(tool.execute('c', validParams())).rejects.toThrow(
        /not configured|stayfinder_signup/i,
      );
      // Should NOT have called the adapter
      expect(AdapterClient).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('calls the adapter, returns the full response as JSON + usage hint, and includes the redirect_link reminder', async () => {
      vi.mocked(readCredential).mockResolvedValueOnce(sampleCredential());
      mockSearch(async () => sampleResponse());

      const tool = createSearchStaysTool(fakeApi());
      const result = await tool.execute('c', validParams());

      // Check the text content includes the JSON and the usage hint
      const text = result.content[0].text;
      expect(text).toContain('The Ludlow');
      expect(text).toContain('redirect_link');
      expect(text).toContain('NOTE FOR ASSISTANT');
      expect(text).toContain('Do not construct your own booking URLs');

      // Check that details is the raw response object
      expect(result.details.result_count).toBe(1);
      expect(result.details.results[0].property_id).toBe('p1');
    });

    it('passes the intent field through when provided', async () => {
      vi.mocked(readCredential).mockResolvedValueOnce(sampleCredential());
      let capturedBody: unknown = null;
      const ctor = AdapterClient as unknown as ReturnType<typeof vi.fn>;
      ctor.mockImplementation(function (this: object) {
        Object.assign(this, {
          searchStays: async (body: unknown) => {
            capturedBody = body;
            return sampleResponse();
          },
        });
      });

      const tool = createSearchStaysTool(fakeApi());
      await tool.execute('c', {
        ...validParams(),
        intent: 'romantic anniversary weekend',
      });

      expect((capturedBody as Record<string, unknown>).intent).toBe(
        'romantic anniversary weekend',
      );
    });
  });

  describe('pre-HTTP validation', () => {
    it('rejects check_out before check_in without calling the adapter', async () => {
      vi.mocked(readCredential).mockResolvedValueOnce(sampleCredential());
      const tool = createSearchStaysTool(fakeApi());
      await expect(
        tool.execute('c', {
          ...validParams(),
          check_in: '2026-05-04',
          check_out: '2026-05-01',
        }),
      ).rejects.toThrow(/swap the dates/i);
      expect(AdapterClient).not.toHaveBeenCalled();
    });

    it('rejects a stay longer than 30 nights without calling the adapter', async () => {
      vi.mocked(readCredential).mockResolvedValueOnce(sampleCredential());
      const tool = createSearchStaysTool(fakeApi());
      await expect(
        tool.execute('c', {
          ...validParams(),
          check_in: '2026-05-01',
          check_out: '2026-06-05',
        }),
      ).rejects.toThrow(/35 nights/);
    });
  });

  describe('adapter error mapping', () => {
    it('maps token_expired through formatErrorForModel', async () => {
      vi.mocked(readCredential).mockResolvedValueOnce(sampleCredential());
      mockSearch(async () => {
        throw new AdapterError(
          { error: { code: 'token_expired', message: 'expired' } },
          401,
        );
      });
      const tool = createSearchStaysTool(fakeApi());
      await expect(tool.execute('c', validParams())).rejects.toThrow(
        /expired|stayfinder_signup/i,
      );
    });

    it('maps tenant_quota_exceeded with retry minutes', async () => {
      vi.mocked(readCredential).mockResolvedValueOnce(sampleCredential());
      mockSearch(async () => {
        throw new AdapterError(
          {
            error: {
              code: 'tenant_quota_exceeded',
              message: 'quota hit',
              retry_after_seconds: 480,
            },
          },
          429,
        );
      });
      const tool = createSearchStaysTool(fakeApi());
      await expect(tool.execute('c', validParams())).rejects.toThrow(/8 minutes/);
    });

    it('maps destination_ambiguous with candidate list', async () => {
      vi.mocked(readCredential).mockResolvedValueOnce(sampleCredential());
      mockSearch(async () => {
        throw new AdapterError(
          {
            error: {
              code: 'destination_ambiguous',
              message: 'multiple matches',
              details: {
                candidates: [
                  { label: 'Springfield, IL' },
                  { label: 'Springfield, MO' },
                ],
              },
            },
          },
          409,
        );
      });
      const tool = createSearchStaysTool(fakeApi());
      await expect(tool.execute('c', validParams())).rejects.toThrow(
        /Springfield, IL/,
      );
    });

    it('passes through non-AdapterError (network, timeout) as-is', async () => {
      vi.mocked(readCredential).mockResolvedValueOnce(sampleCredential());
      mockSearch(async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:8080');
      });
      const tool = createSearchStaysTool(fakeApi());
      await expect(tool.execute('c', validParams())).rejects.toThrow(
        /ECONNREFUSED/,
      );
    });
  });
});
