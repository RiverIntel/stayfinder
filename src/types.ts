/**
 * Shared TypeScript types for the StayFinder plugin.
 *
 * These mirror the public adapter API surface (the request/response shapes
 * for `POST /v1/search/stays`, `POST /v1/signup`, `POST /v1/signup/verify`,
 * `GET /v1/tenant/me`) and the on-disk credential store shape.
 *
 * They are deliberately a SUBSET of what the adapter returns — we only type
 * the fields the plugin actually reads. The adapter is free to add new
 * fields without breaking us; missing optional fields parse fine; unexpected
 * extra fields are silently ignored at runtime.
 *
 * The single source of truth for the wire format is the adapter spec at
 * docs/expedia-adapter-cloudrun-spec.md §7 (in the private operations repo).
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** ISO-8601 timestamp string, e.g. "2026-04-15T22:32:39.436Z". */
export type IsoTimestamp = string;

/** YYYY-MM-DD date string. */
export type IsoDate = string;

// ---------------------------------------------------------------------------
// Plugin config (from openclaw.json's plugins.entries.stayfinder.config)
// ---------------------------------------------------------------------------

export interface StayFinderPluginConfig {
  /** Base URL of the StayFinder service. Defaults to the public hosted endpoint. */
  adapter_url: string;
  /** ISO-3166-1 alpha-2 country code for point-of-sale. Defaults to 'US'. */
  default_pos_country: string;
  /** ISO-4217 currency code. If unset, the adapter falls back to the POS default. */
  default_currency?: string;
  /** HTTP timeout for adapter calls, in milliseconds. Defaults to 10000. */
  request_timeout_ms: number;
}

// ---------------------------------------------------------------------------
// /v1/search/stays
// ---------------------------------------------------------------------------

export type LodgingType = 'hotel' | 'vacation_rental' | 'any';
export type SortOrder =
  | 'recommended'
  | 'price_asc'
  | 'price_desc'
  | 'rating_desc'
  | 'distance';

export interface SearchStaysFilters {
  pet_friendly?: boolean;
  free_cancellation?: boolean;
  min_star_rating?: number;
  max_star_rating?: number;
  price_min?: number;
  price_max?: number;
}

export interface SearchStaysRequest {
  destination: string;
  check_in: IsoDate;
  check_out: IsoDate;
  adults: number;
  children_ages?: number[];
  lodging_type?: LodgingType;
  filters?: SearchStaysFilters;
  sort?: SortOrder;
  limit?: number;
  pos_country?: string;
  currency?: string;
  intent?: string;
}

/**
 * Free-text fields that come back wrapped in
 * <<<EXTERNAL_UNTRUSTED_CONTENT id="..."> ... <<<END_EXTERNAL_UNTRUSTED_CONTENT id="...">
 * sentinels by the adapter. Typed as string here; the wrapping is plain
 * text inside the string and the model is expected to recognize it.
 */
export type WrappedString = string;

export interface SearchStaysProperty {
  property_id: string;
  name: WrappedString;
  property_type?: string;
  neighborhood?: WrappedString;
  star_rating: number | null;
  guest_rating?: {
    score: number | null;
    scale: number;
    review_count: number;
  };
  price: {
    amount_per_night: number;
    amount_total: number;
    currency: string;
    taxes_included: boolean;
    fees_estimate?: number;
  };
  free_cancellation?: boolean;
  pet_friendly?: boolean;
  descriptions?: {
    location?: WrappedString;
    hotel?: WrappedString;
    room?: WrappedString;
  };
  distance?: {
    value: number;
    unit: 'km' | 'mi';
  };
  thumbnail_url?: string;
  redirect_link: string;
  geo?: {
    lat: number;
    lng: number;
    obfuscated?: boolean;
  };
}

export interface SearchStaysResponse {
  request_id: string;
  trace_id?: string;
  cached: boolean;
  cached_at: IsoTimestamp;
  cache_ttl_seconds: number;
  brand?: 'expedia' | 'vrbo';
  resolved_destination?: {
    id: string;
    label: string;
    type: string;
  };
  check_in: IsoDate;
  check_out: IsoDate;
  nights: number;
  party: { adults: number; children: number };
  currency: string;
  result_count: number;
  total_available?: number | null;
  warnings: Array<{ code: string; message: string }>;
  results: SearchStaysProperty[];
}

// ---------------------------------------------------------------------------
// /v1/signup and /v1/signup/verify
// ---------------------------------------------------------------------------

export interface SignupResponse {
  status: 'verification_sent';
  message: string;
  expires_in_seconds: number;
}

export interface SignupVerifyResponse {
  status: 'verified';
  tenant_id: string;
  /** Plaintext API token — returned ONCE; never request twice. */
  token: string;
  token_kind: 'ephemeral' | 'persistent';
  expires_at: IsoTimestamp | null;
  quota_per_hour: number;
  default_pos: string;
}

// ---------------------------------------------------------------------------
// /v1/tenant/me
// ---------------------------------------------------------------------------

export interface TenantMeResponse {
  tenant_id: string;
  name: string | null;
  email: string | null;
  quota: {
    limit_per_hour: number;
    remaining: number;
    reset_at: IsoTimestamp;
  };
  token: {
    kind: 'ephemeral' | 'persistent';
    expires_at: IsoTimestamp | null;
  };
  default_pos: string;
}

// ---------------------------------------------------------------------------
// Error envelope (returned for any non-2xx response from the adapter)
// ---------------------------------------------------------------------------

/**
 * Every known adapter error code, in one place. The plugin maps each one
 * to a model-facing message in errors.ts. Unknown codes still parse fine
 * (the AdapterErrorEnvelope.code field is `string`, not this union) — the
 * union is for exhaustive switch coverage in the mapper.
 */
export type AdapterErrorCode =
  | 'invalid_request'
  | 'missing_field'
  | 'invalid_email'
  | 'disposable_email'
  | 'code_invalid'
  | 'code_expired'
  | 'code_attempts_exceeded'
  | 'unauthorized'
  | 'token_expired'
  | 'tenant_suspended'
  | 'tenant_quota_exceeded'
  | 'global_quota_exceeded'
  | 'signup_rate_limited'
  | 'destination_not_found'
  | 'destination_ambiguous'
  | 'expedia_upstream_error'
  | 'upstream_timeout'
  | 'upstream_unavailable'
  | 'internal_error';

export interface AdapterErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id?: string;
    trace_id?: string;
    retry_after_seconds?: number;
    attempts_remaining?: number;
    expires_at?: string | null;
    upstream_status?: number | null;
    transaction_id?: string;
    pos_country?: string;
    details?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Credential file shape (~/.openclaw/credentials/stayfinder.json)
// ---------------------------------------------------------------------------

export interface CredentialFile {
  /** Plaintext API token, "oct_..." prefix. */
  api_token: string;
  /** ISO-8601 timestamp when the file was last written. */
  saved_at: IsoTimestamp;
  /** Tenant ID the token belongs to. */
  tenant_id: string;
  /** Email the tenant was registered under (used for re-auth). */
  email: string;
  /** Token kind: ephemeral tokens slide; persistent ones don't. */
  token_kind: 'ephemeral' | 'persistent';
  /** Token's current expires_at; null for persistent tokens. */
  expires_at: IsoTimestamp | null;
}
