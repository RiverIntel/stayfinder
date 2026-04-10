/**
 * Safe reader for the plugin's config block.
 *
 * OpenClaw passes plugin config as `api.pluginConfig: Record<string, unknown>`,
 * which means we have to defensively type-check every field. The shape we
 * expect is described by the `configSchema` in `openclaw.plugin.json` and
 * by the `StayFinderPluginConfig` type in types.ts, but the runtime value
 * is whatever happens to be in the user's `~/.openclaw/openclaw.json` file
 * — possibly typoed, possibly missing fields, possibly hand-edited.
 *
 * The defaults here are the ones a fresh install gets if the user puts
 * the minimum into their config (just `enabled: true`, no `config` block
 * at all). They mirror what the README documents.
 */

import type { StayFinderPluginConfig } from './types.js';

/**
 * The public hosted StayFinder service. Self-hosters can point at their
 * own deployment by setting `adapter_url` in plugin config.
 */
export const DEFAULT_ADAPTER_URL = 'https://api.stayfinder.riverintel.com';
export const DEFAULT_POS_COUNTRY = 'US';
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringField = (
  raw: Record<string, unknown>,
  key: string,
  fallback: string,
): string => {
  const value = raw[key];
  if (typeof value === 'string' && value.length > 0) return value;
  return fallback;
};

const optionalString = (
  raw: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = raw[key];
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
};

const numberField = (
  raw: Record<string, unknown>,
  key: string,
  fallback: number,
): number => {
  const value = raw[key];
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return fallback;
};

/**
 * Read the plugin config from `api.pluginConfig` and apply defaults.
 *
 * Always returns a complete StayFinderPluginConfig object — no field is
 * undefined except `default_currency`, which is genuinely optional and
 * the adapter handles its absence by falling back to the POS-country
 * default. Pass-through of an unset field beats injecting a wrong default.
 *
 * Strips `https://` schema validation from `adapter_url`: in dev we want
 * to allow `http://localhost:8080`, but the configSchema in
 * openclaw.plugin.json keeps the `https://` requirement to keep production
 * users honest. The plugin runtime accepts whatever the schema lets through.
 */
export function readPluginConfig(
  pluginConfig: unknown | undefined,
): StayFinderPluginConfig {
  const raw = isRecord(pluginConfig) ? pluginConfig : {};
  return {
    adapter_url: stringField(raw, 'adapter_url', DEFAULT_ADAPTER_URL),
    default_pos_country: stringField(raw, 'default_pos_country', DEFAULT_POS_COUNTRY),
    default_currency: optionalString(raw, 'default_currency'),
    request_timeout_ms: numberField(
      raw,
      'request_timeout_ms',
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
  };
}
