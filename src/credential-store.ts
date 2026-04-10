/**
 * On-disk credential store for the StayFinder plugin.
 *
 * The plugin writes a single JSON file at ~/.openclaw/credentials/stayfinder.json
 * (mode 0600 — readable only by the user) containing the API token and
 * the small amount of metadata the plugin needs to drive re-auth without
 * re-prompting the user for their email.
 *
 * The credential file shape is documented in types.ts (CredentialFile)
 * and matches what stayfinder_verify writes after a successful exchange.
 *
 * Why a file (and not OpenClaw's credential API):
 *   The plugin manifest's `credentialPath` field is a READ-time hint, not
 *   a write API. There's no documented runtime API for plugins to write
 *   their own credentials back through OpenClaw. Owning the file directly
 *   at the documented path is the simplest forward-compatible answer:
 *   if a write API ever lands, we switch to it; until then, the file
 *   format we control is the contract.
 *
 * Read pattern:
 *   - search-stays.ts reads the file on every call (no in-process cache)
 *     so a fresh stayfinder_verify takes effect immediately
 *   - The file is small (~200 bytes) and the read is local; the cost
 *     is irrelevant
 *
 * Write pattern:
 *   - stayfinder-verify.ts writes the file once after a successful
 *     /v1/signup/verify response
 *   - Atomic write via "write to temp + rename" so a crash mid-write
 *     can't leave a half-written file the next read would choke on
 *   - mode 0600 enforced explicitly (Node's default umask honors this
 *     but we set it again at write time as defense in depth)
 */

import { existsSync, mkdirSync } from 'node:fs';
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { CredentialFile } from './types.js';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the credential file path.
 *
 * Honors the OPENCLAW_HOME environment variable if set (used by OpenClaw's
 * test/dev profiles to isolate state). Falls back to ~/.openclaw.
 *
 * The credentials/ subdirectory and the file itself are created on demand
 * by writeCredential. They're never assumed to exist at read time.
 */
export function resolveCredentialPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.OPENCLAW_HOME ?? join(homedir(), '.openclaw');
  return join(home, 'credentials', 'stayfinder.json');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read the credential file. Returns null if it doesn't exist or if its
 * contents don't parse as the expected shape.
 *
 * Critically: a missing or unreadable file returns null, NOT an error.
 * "No credentials" is a normal state — the search_stays tool uses it as
 * the trigger to surface `unauthorized` and walk the user through setup.
 *
 * We DO throw on a permission denied or other unexpected I/O error,
 * because that's an environmental problem the user needs to know about
 * and "silently treat as no creds" would be wrong (we'd loop them
 * through signup forever without ever fixing the underlying issue).
 */
export async function readCredential(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CredentialFile | null> {
  const path = resolveCredentialPath(env);
  let raw: string;
  try {
    raw = await readFile(path, { encoding: 'utf-8' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      `Failed to read credential file at ${path}: ${(err as Error).message}. ` +
        'Check file permissions and re-run signup if needed.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt file — return null and let the user re-run signup. We
    // don't try to recover; a malformed credentials file is rare and
    // signup is cheap.
    return null;
  }

  if (!isValidCredentialFile(parsed)) return null;
  return parsed;
}

/**
 * Write the credential file atomically with mode 0600.
 *
 * Creates the credentials/ directory (mode 0700) if it doesn't exist.
 * Writes to a temp file in the same directory, sets permissions, then
 * renames into place — so a crash mid-write leaves either the old file
 * untouched or the new file complete, never a half-written file.
 *
 * Throws on any I/O failure. The signup_verify tool catches it and
 * surfaces a clean error to the model.
 */
export async function writeCredential(
  credential: CredentialFile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = resolveCredentialPath(env);
  const dir = dirname(path);

  // Create directory with 0700 (rwx user only) if missing.
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const tempPath = `${path}.tmp.${process.pid}`;
  const body = JSON.stringify(credential, null, 2) + '\n';
  await writeFile(tempPath, body, { mode: 0o600, encoding: 'utf-8' });
  // Re-chmod defensively in case the file already existed with looser perms.
  await chmod(tempPath, 0o600);
  await rename(tempPath, path);
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Type guard for CredentialFile. Used by readCredential to reject malformed
 * files. We check every required field; an old file from a previous version
 * of the plugin that lacks newer fields will be rejected and the user will
 * re-run signup. That's the right tradeoff: re-signup is cheap (one paste)
 * and silently accepting partial data risks weird state.
 */
function isValidCredentialFile(value: unknown): value is CredentialFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.api_token === 'string' &&
    v.api_token.length > 0 &&
    typeof v.saved_at === 'string' &&
    typeof v.tenant_id === 'string' &&
    typeof v.email === 'string' &&
    (v.token_kind === 'ephemeral' || v.token_kind === 'persistent') &&
    (v.expires_at === null || typeof v.expires_at === 'string')
  );
}
