/**
 * Tests for AdapterClient. We inject a fake `fetch` so the suite never
 * touches the network. Each test asserts:
 *
 *   1. The right URL is built (base + path, no double slashes)
 *   2. The right headers are sent (User-Agent, Authorization, Accept,
 *      Content-Type when there's a body)
 *   3. The right body is sent (correctly JSON-stringified)
 *   4. The right method is used (GET vs POST)
 *   5. 2xx responses are parsed as JSON and returned
 *   6. Non-2xx responses with the standard error envelope throw
 *      AdapterError carrying the right fields
 *   7. Non-2xx responses without a JSON body throw a synthetic
 *      AdapterError with code 'internal_error'
 *   8. The authenticated-but-no-token combination throws synchronously
 *      (so a misconfigured tool fails loudly instead of silently calling
 *      with no auth header)
 *   9. Calling /v1/signup or /v1/signup/verify without a token works fine
 *  10. The default fetch is globalThis.fetch when no override is given
 *      (smoke check only)
 */
import { describe, expect, it, vi } from 'vitest';
import { AdapterClient, type FetchLike } from './adapter-client.js';
import { AdapterError } from './errors.js';
import type { StayFinderPluginConfig } from './types.js';

const baseConfig: StayFinderPluginConfig = {
  adapter_url: 'https://api.stayfinder.test',
  default_pos_country: 'US',
  request_timeout_ms: 5000,
};

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Build a fake fetch that captures the request and returns a canned response.
 * Returns both the fake (for AdapterClient) and the captured request (for assertions).
 */
const makeFakeFetch = (response: {
  ok: boolean;
  status: number;
  statusText?: string;
  jsonBody?: unknown;
  textBody?: string;
}): { fetch: FetchLike; calls: CapturedRequest[] } => {
  const calls: CapturedRequest[] = [];
  const fetch: FetchLike = async (input, init) => {
    calls.push({
      url: input,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body,
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText ?? '',
      json: async () => response.jsonBody ?? {},
      text: async () => response.textBody ?? JSON.stringify(response.jsonBody ?? {}),
    };
  };
  return { fetch, calls };
};

describe('AdapterClient.searchStays', () => {
  it('POSTs to /v1/search/stays with the right URL, body, and headers', async () => {
    const { fetch, calls } = makeFakeFetch({
      ok: true,
      status: 200,
      jsonBody: {
        request_id: 'req_abc',
        cached: false,
        cached_at: '2026-04-09T16:00:00Z',
        cache_ttl_seconds: 1200,
        check_in: '2026-05-01',
        check_out: '2026-05-04',
        nights: 3,
        party: { adults: 2, children: 0 },
        currency: 'USD',
        result_count: 0,
        warnings: [],
        results: [],
      },
    });

    const client = new AdapterClient({
      config: baseConfig,
      apiToken: 'oct_test_token',
      pluginVersion: '0.1.0',
      fetch,
    });

    const result = await client.searchStays({
      destination: 'Manhattan',
      check_in: '2026-05-01',
      check_out: '2026-05-04',
      adults: 2,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.stayfinder.test/v1/search/stays');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['Authorization']).toBe('Bearer oct_test_token');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(calls[0].headers['Accept']).toBe('application/json');
    expect(calls[0].headers['User-Agent']).toBe('openclaw-plugin-stayfinder/0.1.0');
    expect(JSON.parse(calls[0].body!)).toEqual({
      destination: 'Manhattan',
      check_in: '2026-05-01',
      check_out: '2026-05-04',
      adults: 2,
    });
    expect(result.request_id).toBe('req_abc');
  });

  it('passes through the optional intent field when provided', async () => {
    const { fetch, calls } = makeFakeFetch({
      ok: true,
      status: 200,
      jsonBody: {
        request_id: 'req',
        cached: false,
        cached_at: '',
        cache_ttl_seconds: 0,
        check_in: '',
        check_out: '',
        nights: 0,
        party: { adults: 1, children: 0 },
        currency: 'USD',
        result_count: 0,
        warnings: [],
        results: [],
      },
    });
    const client = new AdapterClient({
      config: baseConfig,
      apiToken: 'oct_t',
      pluginVersion: '0.1.0',
      fetch,
    });
    await client.searchStays({
      destination: 'Maui',
      check_in: '2026-06-01',
      check_out: '2026-06-05',
      adults: 2,
      intent: 'family vacation with two kids under 10',
    });
    const sent = JSON.parse(calls[0].body!);
    expect(sent.intent).toBe('family vacation with two kids under 10');
  });

  it('strips trailing slashes from adapter_url so the URL has no double slash', async () => {
    const { fetch, calls } = makeFakeFetch({
      ok: true,
      status: 200,
      jsonBody: { request_id: '', cached: false, cached_at: '', cache_ttl_seconds: 0, check_in: '', check_out: '', nights: 0, party: { adults: 1, children: 0 }, currency: 'USD', result_count: 0, warnings: [], results: [] },
    });
    const client = new AdapterClient({
      config: { ...baseConfig, adapter_url: 'https://api.stayfinder.test/' },
      apiToken: 'oct_t',
      pluginVersion: '0.1.0',
      fetch,
    });
    await client.searchStays({
      destination: 'X',
      check_in: '2026-05-01',
      check_out: '2026-05-04',
      adults: 1,
    });
    expect(calls[0].url).toBe('https://api.stayfinder.test/v1/search/stays');
  });

  it('throws synchronously if asked to call an authenticated endpoint with no token', async () => {
    const client = new AdapterClient({
      config: baseConfig,
      // no apiToken
      pluginVersion: '0.1.0',
      fetch: makeFakeFetch({ ok: true, status: 200, jsonBody: {} }).fetch,
    });
    await expect(
      client.searchStays({
        destination: 'X',
        check_in: '2026-05-01',
        check_out: '2026-05-04',
        adults: 1,
      }),
    ).rejects.toThrow(/no token|tried to call an authenticated/i);
  });
});

describe('AdapterClient.signup', () => {
  it('POSTs to /v1/signup with NO Authorization header', async () => {
    const { fetch, calls } = makeFakeFetch({
      ok: true,
      status: 200,
      jsonBody: {
        status: 'verification_sent',
        message: '...',
        expires_in_seconds: 900,
      },
    });
    const client = new AdapterClient({
      config: baseConfig,
      // No token — signup is unauthenticated
      pluginVersion: '0.1.0',
      fetch,
    });
    const result = await client.signup('matt@example.com');
    expect(result.status).toBe('verification_sent');
    expect(calls[0].url).toBe('https://api.stayfinder.test/v1/signup');
    expect(calls[0].headers['Authorization']).toBeUndefined();
    expect(JSON.parse(calls[0].body!)).toEqual({
      email: 'matt@example.com',
      consumer_hint: 'openclaw-plugin-stayfinder/0.1.0',
    });
  });
});

describe('AdapterClient.signupVerify', () => {
  it('POSTs to /v1/signup/verify with email + code', async () => {
    const { fetch, calls } = makeFakeFetch({
      ok: true,
      status: 200,
      jsonBody: {
        status: 'verified',
        tenant_id: 'ten_x',
        token: 'oct_secret',
        token_kind: 'ephemeral',
        expires_at: '2026-04-16T00:00:00Z',
        quota_per_hour: 50,
        default_pos: 'US',
      },
    });
    const client = new AdapterClient({
      config: baseConfig,
      pluginVersion: '0.1.0',
      fetch,
    });
    const result = await client.signupVerify('matt@example.com', '473829');
    expect(result.token).toBe('oct_secret');
    expect(calls[0].url).toBe('https://api.stayfinder.test/v1/signup/verify');
    expect(JSON.parse(calls[0].body!)).toEqual({
      email: 'matt@example.com',
      code: '473829',
    });
  });
});

describe('AdapterClient.tenantMe', () => {
  it('GETs /v1/tenant/me with the auth header', async () => {
    const { fetch, calls } = makeFakeFetch({
      ok: true,
      status: 200,
      jsonBody: {
        tenant_id: 'ten_x',
        name: null,
        email: 'matt@example.com',
        quota: { limit_per_hour: 50, remaining: 50, reset_at: '' },
        token: { kind: 'ephemeral', expires_at: '2026-04-16T00:00:00Z' },
        default_pos: 'US',
      },
    });
    const client = new AdapterClient({
      config: baseConfig,
      apiToken: 'oct_t',
      pluginVersion: '0.1.0',
      fetch,
    });
    const result = await client.tenantMe();
    expect(result.email).toBe('matt@example.com');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].headers['Authorization']).toBe('Bearer oct_t');
    // GET requests don't carry a Content-Type
    expect(calls[0].headers['Content-Type']).toBeUndefined();
  });
});

describe('Error envelope handling', () => {
  it('parses a standard error envelope and throws AdapterError', async () => {
    const { fetch } = makeFakeFetch({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      jsonBody: {
        error: {
          code: 'token_expired',
          message: 'Token expired',
          expires_at: '2026-04-09T00:00:00Z',
        },
      },
    });
    const client = new AdapterClient({
      config: baseConfig,
      apiToken: 'oct_t',
      pluginVersion: '0.1.0',
      fetch,
    });

    let caught: unknown = null;
    try {
      await client.tenantMe();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AdapterError);
    const adapterErr = caught as AdapterError;
    expect(adapterErr.code).toBe('token_expired');
    expect(adapterErr.httpStatus).toBe(401);
    expect(adapterErr.expiresAt).toBe('2026-04-09T00:00:00Z');
  });

  it('parses code_invalid with attempts_remaining', async () => {
    const { fetch } = makeFakeFetch({
      ok: false,
      status: 400,
      jsonBody: {
        error: { code: 'code_invalid', message: 'wrong', attempts_remaining: 2 },
      },
    });
    const client = new AdapterClient({
      config: baseConfig,
      pluginVersion: '0.1.0',
      fetch,
    });
    try {
      await client.signupVerify('matt@example.com', '000000');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as AdapterError).attemptsRemaining).toBe(2);
    }
  });

  it('synthesizes an internal_error envelope when the body is not JSON', async () => {
    const { fetch } = makeFakeFetch({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      textBody: '<html>cloud run cold start crash</html>',
    });
    const client = new AdapterClient({
      config: baseConfig,
      apiToken: 'oct_t',
      pluginVersion: '0.1.0',
      fetch,
    });
    try {
      await client.tenantMe();
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as AdapterError).code).toBe('internal_error');
      expect((err as AdapterError).message).toMatch(/HTTP 502/);
    }
  });

  it('synthesizes an internal_error envelope when the body is empty', async () => {
    const { fetch } = makeFakeFetch({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      textBody: '',
    });
    const client = new AdapterClient({
      config: baseConfig,
      apiToken: 'oct_t',
      pluginVersion: '0.1.0',
      fetch,
    });
    try {
      await client.tenantMe();
      throw new Error('expected throw');
    } catch (err) {
      expect((err as AdapterError).code).toBe('internal_error');
    }
  });
});

describe('Timeout behavior', () => {
  it('throws a timeout error when the request is aborted', async () => {
    // Simulate an AbortError from a fetch that respects the signal.
    const abortingFetch: FetchLike = async (_url, init) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
        // Never resolve.
      });
    };
    const client = new AdapterClient({
      config: { ...baseConfig, request_timeout_ms: 30 },
      apiToken: 'oct_t',
      pluginVersion: '0.1.0',
      fetch: abortingFetch,
    });
    await expect(client.tenantMe()).rejects.toThrow(/timed out after 30ms/);
  });

  it('wraps non-abort fetch errors as plain Error with the original message', async () => {
    const failingFetch: FetchLike = async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:8080');
    };
    const client = new AdapterClient({
      config: baseConfig,
      apiToken: 'oct_t',
      pluginVersion: '0.1.0',
      fetch: failingFetch,
    });
    await expect(client.tenantMe()).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe('default fetch fallback', () => {
  it('uses globalThis.fetch when no override is provided', async () => {
    // We can't actually test that the request goes out without mocking
    // globalThis.fetch — just confirm the constructor doesn't throw and
    // the client is constructable. Real network calls are covered by
    // the live smoke test against the deployed adapter.
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          tenant_id: 'ten_x',
          name: null,
          email: null,
          quota: { limit_per_hour: 50, remaining: 50, reset_at: '' },
          token: { kind: 'persistent', expires_at: null },
          default_pos: 'US',
        }),
        text: async () => '',
      } as unknown as Response);

    const client = new AdapterClient({
      config: baseConfig,
      apiToken: 'oct_t',
      pluginVersion: '0.1.0',
    });
    await client.tenantMe();
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
