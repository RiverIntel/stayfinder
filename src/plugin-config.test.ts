import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADAPTER_URL,
  DEFAULT_POS_COUNTRY,
  DEFAULT_REQUEST_TIMEOUT_MS,
  readPluginConfig,
} from './plugin-config.js';

describe('readPluginConfig', () => {
  it('returns all defaults when given undefined', () => {
    const cfg = readPluginConfig(undefined);
    expect(cfg.adapter_url).toBe(DEFAULT_ADAPTER_URL);
    expect(cfg.default_pos_country).toBe(DEFAULT_POS_COUNTRY);
    expect(cfg.request_timeout_ms).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(cfg.default_currency).toBeUndefined();
  });

  it('returns all defaults when given an empty object', () => {
    const cfg = readPluginConfig({});
    expect(cfg.adapter_url).toBe(DEFAULT_ADAPTER_URL);
  });

  it('honors a user-supplied adapter_url', () => {
    const cfg = readPluginConfig({ adapter_url: 'http://localhost:8080' });
    expect(cfg.adapter_url).toBe('http://localhost:8080');
  });

  it('honors a user-supplied default_pos_country and default_currency', () => {
    const cfg = readPluginConfig({
      default_pos_country: 'GB',
      default_currency: 'GBP',
    });
    expect(cfg.default_pos_country).toBe('GB');
    expect(cfg.default_currency).toBe('GBP');
  });

  it('honors a user-supplied request_timeout_ms', () => {
    const cfg = readPluginConfig({ request_timeout_ms: 5000 });
    expect(cfg.request_timeout_ms).toBe(5000);
  });

  it('falls back to default for non-numeric request_timeout_ms', () => {
    const cfg = readPluginConfig({ request_timeout_ms: 'fast' });
    expect(cfg.request_timeout_ms).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });

  it('falls back to default for negative request_timeout_ms', () => {
    const cfg = readPluginConfig({ request_timeout_ms: -1 });
    expect(cfg.request_timeout_ms).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });

  it('falls back to default for empty-string adapter_url', () => {
    const cfg = readPluginConfig({ adapter_url: '' });
    expect(cfg.adapter_url).toBe(DEFAULT_ADAPTER_URL);
  });

  it('ignores non-string adapter_url', () => {
    const cfg = readPluginConfig({ adapter_url: 42 });
    expect(cfg.adapter_url).toBe(DEFAULT_ADAPTER_URL);
  });

  it('handles non-record input gracefully (string, array, null)', () => {
    expect(readPluginConfig('not an object').adapter_url).toBe(DEFAULT_ADAPTER_URL);
    expect(readPluginConfig([1, 2, 3]).adapter_url).toBe(DEFAULT_ADAPTER_URL);
    expect(readPluginConfig(null).adapter_url).toBe(DEFAULT_ADAPTER_URL);
  });
});
