/**
 * HTTP client for the StayFinder service.
 *
 * Intentionally minimal: builds the request, fires it, parses the
 * response, and either returns the success body or throws an
 * `AdapterError` for the caller to format. No retries (the adapter
 * already retries to Expedia internally), no connection pooling
 * beyond Node's defaults, no in-process caching.
 *
 * The client is a class so tools can inject a fake `fetch` for tests.
 * Production code constructs one per call from the tool's `execute`
 * function — no global state, no singletons, no init step. The class
 * is small enough that the per-call cost is irrelevant.
 */

import { AdapterError } from './errors.js';
import type {
  AdapterErrorEnvelope,
  SearchStaysRequest,
  SearchStaysResponse,
  SignupResponse,
  SignupVerifyResponse,
  StayFinderPluginConfig,
  TenantMeResponse,
} from './types.js';

/**
 * Minimal `fetch` shape we depend on. Matches the global `fetch`
 * available in Node 20+ and lets tests inject a fake without pulling
 * in any HTTP-mocking library.
 */
export type FetchLike = (
  input: string,
  init?: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface AdapterClientOptions {
  /** Plugin config (defaults are applied by readPluginConfig before this is constructed). */
  config: StayFinderPluginConfig;
  /** Bearer token for authenticated endpoints. Omit for /v1/signup and /v1/signup/verify. */
  apiToken?: string;
  /** Plugin version, included in the User-Agent header for adapter logs. */
  pluginVersion: string;
  /** Optional fetch override for tests. Defaults to globalThis.fetch. */
  fetch?: FetchLike;
}

/**
 * Body shape we POST to /v1/search/stays. The plugin's TypeBox schema
 * matches this exactly; we re-state it as a TS type to keep the HTTP
 * layer self-contained and to make it obvious to a code reader what
 * the wire format is.
 *
 * Identical to SearchStaysRequest from types.ts; aliased here for clarity.
 */
export type SearchStaysRequestBody = SearchStaysRequest;

export class AdapterClient {
  private readonly config: StayFinderPluginConfig;
  private readonly apiToken: string | undefined;
  private readonly userAgent: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: AdapterClientOptions) {
    this.config = opts.config;
    this.apiToken = opts.apiToken;
    this.userAgent = `openclaw-plugin-stayfinder/${opts.pluginVersion}`;
    this.fetchImpl = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  // -------------------------------------------------------------------------
  // Public methods — one per adapter endpoint we call
  // -------------------------------------------------------------------------

  searchStays(body: SearchStaysRequestBody): Promise<SearchStaysResponse> {
    return this.post<SearchStaysResponse>('/v1/search/stays', body, { authenticated: true });
  }

  signup(email: string): Promise<SignupResponse> {
    return this.post<SignupResponse>(
      '/v1/signup',
      { email, consumer_hint: this.userAgent },
      { authenticated: false },
    );
  }

  signupVerify(email: string, code: string): Promise<SignupVerifyResponse> {
    return this.post<SignupVerifyResponse>(
      '/v1/signup/verify',
      { email, code },
      { authenticated: false },
    );
  }

  tenantMe(): Promise<TenantMeResponse> {
    return this.get<TenantMeResponse>('/v1/tenant/me', { authenticated: true });
  }

  // -------------------------------------------------------------------------
  // Internal HTTP plumbing
  // -------------------------------------------------------------------------

  private async post<T>(
    path: string,
    body: unknown,
    opts: { authenticated: boolean },
  ): Promise<T> {
    return this.request<T>('POST', path, JSON.stringify(body), opts);
  }

  private async get<T>(path: string, opts: { authenticated: boolean }): Promise<T> {
    return this.request<T>('GET', path, undefined, opts);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: string | undefined,
    opts: { authenticated: boolean },
  ): Promise<T> {
    const url = this.buildUrl(path);
    const headers = this.buildHeaders(body !== undefined, opts.authenticated);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.request_timeout_ms);

    let res;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      if (isAbort) {
        throw new Error(
          `StayFinder request to ${path} timed out after ${this.config.request_timeout_ms}ms. ` +
            'The service may be slow or unreachable. Tell the user briefly and offer to retry.',
        );
      }
      throw new Error(
        `StayFinder request to ${path} failed: ${(err as Error).message}. ` +
          'Check that the adapter URL is correct and reachable.',
      );
    } finally {
      clearTimeout(timer);
    }

    // -----------------------------------------------------------------------
    // Non-2xx → parse the standard error envelope and throw AdapterError
    // -----------------------------------------------------------------------
    if (!res.ok) {
      // Read the body once. If it parses as our error envelope, surface
      // that; otherwise wrap the raw text in a generic error so we still
      // see what came back.
      let envelope: AdapterErrorEnvelope | null = null;
      let rawText = '';
      try {
        rawText = await res.text();
        const parsed = rawText.length > 0 ? (JSON.parse(rawText) as unknown) : null;
        if (
          parsed &&
          typeof parsed === 'object' &&
          'error' in (parsed as Record<string, unknown>)
        ) {
          envelope = parsed as AdapterErrorEnvelope;
        }
      } catch {
        // body wasn't JSON; fall through to the synthetic envelope below
      }

      if (envelope) {
        throw new AdapterError(envelope, res.status);
      }

      // Synthetic envelope for "the server returned a non-2xx with no
      // structured body" — usually a Cloud Run-side outage rather than
      // an application error. Surface it as `internal_error` so the
      // model gets a coherent recovery path.
      const synthetic: AdapterErrorEnvelope = {
        error: {
          code: 'internal_error',
          message:
            `StayFinder service returned HTTP ${res.status} ${res.statusText} ` +
            `with no JSON body${rawText ? ` (body excerpt: ${rawText.slice(0, 200)})` : ''}`,
        },
      };
      throw new AdapterError(synthetic, res.status);
    }

    // -----------------------------------------------------------------------
    // 2xx → parse JSON and return
    // -----------------------------------------------------------------------
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new Error(
        `StayFinder response from ${path} was not valid JSON: ${(err as Error).message}`,
      );
    }
  }

  private buildUrl(path: string): string {
    // Trim trailing slash off adapter_url so we don't end up with double
    // slashes in the path. Adapter URLs from the config schema are
    // unlikely to have one, but defense in depth.
    const base = this.config.adapter_url.replace(/\/+$/, '');
    return `${base}${path}`;
  }

  private buildHeaders(hasBody: boolean, authenticated: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };
    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }
    if (authenticated) {
      if (!this.apiToken) {
        throw new Error(
          'Internal: tried to call an authenticated StayFinder endpoint without a token. ' +
            'This is a plugin bug — adapter-client.ts should have refused to construct.',
        );
      }
      headers['Authorization'] = `Bearer ${this.apiToken}`;
    }
    return headers;
  }
}
