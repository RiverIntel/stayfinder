/**
 * Tests for the on-disk credential store. Each test runs against a
 * temporary OPENCLAW_HOME so we never touch the real ~/.openclaw
 * directory and can run in parallel without races.
 */
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readCredential,
  resolveCredentialPath,
  writeCredential,
} from './credential-store.js';
import type { CredentialFile } from './types.js';

let tempHome: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), 'stayfinder-creds-'));
  env = { OPENCLAW_HOME: tempHome };
});

afterEach(async () => {
  await rm(tempHome, { recursive: true, force: true });
});

const sampleCredential = (): CredentialFile => ({
  api_token: 'oct_test_FAKE_TOKEN_xxxxxxxxxxxxxxxxxx',
  saved_at: '2026-04-09T16:00:00.000Z',
  tenant_id: 'ten_01HXY_TEST',
  email: 'matt@example.com',
  token_kind: 'ephemeral',
  expires_at: '2026-04-16T16:00:00.000Z',
});

describe('resolveCredentialPath', () => {
  it('honors OPENCLAW_HOME when set', () => {
    expect(resolveCredentialPath({ OPENCLAW_HOME: '/tmp/foo' })).toBe(
      '/tmp/foo/credentials/stayfinder.json',
    );
  });

  it('falls back to ~/.openclaw when OPENCLAW_HOME is unset', () => {
    const path = resolveCredentialPath({});
    expect(path).toMatch(/\.openclaw\/credentials\/stayfinder\.json$/);
  });
});

describe('readCredential', () => {
  it('returns null when the file does not exist', async () => {
    const result = await readCredential(env);
    expect(result).toBeNull();
  });

  it('returns null when the directory does not exist', async () => {
    // tempHome exists but no credentials/ subdir inside it
    const result = await readCredential(env);
    expect(result).toBeNull();
  });

  it('returns the parsed credential when the file is well-formed', async () => {
    await writeCredential(sampleCredential(), env);
    const result = await readCredential(env);
    expect(result).toEqual(sampleCredential());
  });

  it('returns null when the file is not valid JSON', async () => {
    const path = resolveCredentialPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'this is not json {{{');
    expect(await readCredential(env)).toBeNull();
  });

  it('returns null when the JSON is missing required fields', async () => {
    const path = resolveCredentialPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ api_token: 'oct_x' })); // missing email, tenant_id, etc.
    expect(await readCredential(env)).toBeNull();
  });

  it('returns null when token_kind is an unknown enum value', async () => {
    const broken = { ...sampleCredential(), token_kind: 'mystery' };
    const path = resolveCredentialPath(env);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(broken));
    expect(await readCredential(env)).toBeNull();
  });

  it('accepts a persistent credential with null expires_at', async () => {
    const persistent: CredentialFile = {
      ...sampleCredential(),
      token_kind: 'persistent',
      expires_at: null,
    };
    await writeCredential(persistent, env);
    const result = await readCredential(env);
    expect(result?.token_kind).toBe('persistent');
    expect(result?.expires_at).toBeNull();
  });
});

describe('writeCredential', () => {
  it('creates the credentials/ directory if it does not exist', async () => {
    await writeCredential(sampleCredential(), env);
    const dir = join(tempHome, 'credentials');
    const dirStat = await stat(dir);
    expect(dirStat.isDirectory()).toBe(true);
  });

  it('writes a file readable as JSON', async () => {
    await writeCredential(sampleCredential(), env);
    const path = resolveCredentialPath(env);
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(sampleCredential());
  });

  it('writes the file with mode 0600', async () => {
    await writeCredential(sampleCredential(), env);
    const path = resolveCredentialPath(env);
    const fileStat = await stat(path);
    // Mask off the file-type bits, leave only the permission bits.
    const mode = fileStat.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('overwrites an existing credential file (the re-auth case)', async () => {
    await writeCredential(sampleCredential(), env);
    const updated: CredentialFile = {
      ...sampleCredential(),
      api_token: 'oct_NEW_TOKEN_after_reauth',
      saved_at: '2026-04-15T16:00:00.000Z',
    };
    await writeCredential(updated, env);
    const result = await readCredential(env);
    expect(result?.api_token).toBe('oct_NEW_TOKEN_after_reauth');
  });

  it('does not leave a temp file behind on success', async () => {
    await writeCredential(sampleCredential(), env);
    const path = resolveCredentialPath(env);
    // The temp file pattern is "<path>.tmp.<pid>"; check it's gone after rename.
    const tempPath = `${path}.tmp.${process.pid}`;
    let tempExists = false;
    try {
      await stat(tempPath);
      tempExists = true;
    } catch {
      tempExists = false;
    }
    expect(tempExists).toBe(false);
  });
});

describe('round-trip', () => {
  it('writes then reads back identical content', async () => {
    const original = sampleCredential();
    await writeCredential(original, env);
    const roundTripped = await readCredential(env);
    expect(roundTripped).toEqual(original);
  });

  it('round-trips a persistent (null expires_at) credential too', async () => {
    const persistent: CredentialFile = {
      api_token: 'oct_persistent_operator_token',
      saved_at: '2026-04-09T16:00:00.000Z',
      tenant_id: 'ten_op',
      email: '',
      token_kind: 'persistent',
      expires_at: null,
    };
    await writeCredential(persistent, env);
    const result = await readCredential(env);
    expect(result).toEqual(persistent);
  });
});
