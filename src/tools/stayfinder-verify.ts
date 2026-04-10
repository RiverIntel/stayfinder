/**
 * `stayfinder_verify` bootstrap tool.
 *
 * Exchanges the 6-digit code the user pasted back into the chat for an
 * opaque API token, then writes it to the credential store. The user
 * never sees the token — this tool handles it end-to-end.
 *
 * Always called as the second step after `stayfinder_signup`. The model
 * provides both the email (same one it passed to signup) and the code
 * (the 6 digits the user pasted). The tool:
 *
 *   1. Sanitizes the code (strips whitespace / dashes / stray chars)
 *   2. Calls POST /v1/signup/verify with {email, code}
 *   3. On success: writes the token + tenant metadata to the credential
 *      store at ~/.openclaw/credentials/stayfinder.json, then returns a
 *      friendly "you're set up" message
 *   4. On error: throws with a model-facing message from formatErrorForModel
 *      so the agent knows the concrete next step (retry, send a fresh code,
 *      etc.)
 */

import { Type } from '@sinclair/typebox';

import { AdapterClient } from '../adapter-client.js';
import { writeCredential } from '../credential-store.js';
import { AdapterError, formatErrorForModel } from '../errors.js';
import { readPluginConfig } from '../plugin-config.js';
import { toolTextResult } from '../tool-result.js';
import type { CredentialFile } from '../types.js';
import { sanitizeAndValidateCode, validateEmailLoose } from '../validation.js';

const TOOL_NAME = 'stayfinder_verify';

export const StayFinderVerifyParamsSchema = Type.Object(
  {
    email: Type.String({
      minLength: 5,
      maxLength: 254,
      description: 'The same email address used when calling stayfinder_signup.',
    }),
    code: Type.String({
      minLength: 1,
      maxLength: 20,
      description:
        'The 6-digit verification code from the email. ' +
        'Pass exactly 6 decimal digits. Stray spaces or dashes are OK — the plugin strips them.',
    }),
  },
  { additionalProperties: false },
);

const TOOL_DESCRIPTION =
  'Submit the 6-digit verification code the user received in their email. ' +
  'This exchanges the code for an API token, which the plugin saves to its credential store automatically. ' +
  'Use this after stayfinder_signup, once the user has pasted their 6-digit code into the chat. ' +
  'The user only ever pastes the code (six digits). They do not — and cannot — paste a token; ' +
  'the token is written directly to the credential store and never shown to the user. ' +
  'Required: email (the same address used in stayfinder_signup), code (six digits).';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createStayFinderVerifyTool(api: any): any {
  return {
    name: TOOL_NAME,
    label: 'StayFinder Verify',
    description: TOOL_DESCRIPTION,
    parameters: StayFinderVerifyParamsSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (_toolCallId: string, rawParams: any) => {
      const email = typeof rawParams?.email === 'string' ? rawParams.email.trim() : '';
      const rawCode = typeof rawParams?.code === 'string' ? rawParams.code : '';

      // ----- Local validation (fail before HTTP) -----

      const emailError = validateEmailLoose(email);
      if (emailError) throw new Error(emailError);

      const cleanedCode = sanitizeAndValidateCode(rawCode);
      if (cleanedCode === null) {
        throw new Error(
          'That doesn\'t look like a 6-digit code. ' +
            'The code is six numbers (like 473829) from the StayFinder email. ' +
            'Ask the user to copy just the digits.',
        );
      }

      // ----- Call the adapter -----

      const config = readPluginConfig(api.pluginConfig);
      const client = new AdapterClient({
        config,
        // No apiToken — verify is unauthenticated
        pluginVersion: api.version ?? '0.0.0',
      });

      let response;
      try {
        response = await client.signupVerify(email, cleanedCode);
      } catch (err) {
        if (err instanceof AdapterError) {
          throw new Error(formatErrorForModel(err));
        }
        throw err;
      }

      // ----- Write credentials to disk -----

      const credential: CredentialFile = {
        api_token: response.token,
        saved_at: new Date().toISOString(),
        tenant_id: response.tenant_id,
        email,
        token_kind: response.token_kind,
        expires_at: response.expires_at,
      };

      try {
        await writeCredential(credential);
      } catch (err) {
        throw new Error(
          `Got the token but failed to save it: ${(err as Error).message}. ` +
            'Check file permissions on ~/.openclaw/credentials/ and try again.',
        );
      }

      // ----- Drop the token from memory (defense in depth) -----
      // `response.token` is still in scope but goes out of scope when
      // this function returns. We could set `response.token = ''` to
      // zero it early, but that would require a mutable binding which
      // makes the code less clear. The GC will collect it shortly.

      // ----- Return success message -----

      const expiryNote =
        response.token_kind === 'ephemeral' && response.expires_at
          ? ` Your access will stay active as long as you keep using it (re-auth after about a week of inactivity).`
          : '';

      const message =
        `Got it! Your StayFinder access is active. ` +
        `${response.quota_per_hour} searches per hour.${expiryNote} ` +
        `You can now use search_stays to find hotels and vacation rentals.`;

      return toolTextResult(message, {
        status: 'verified',
        tenant_id: response.tenant_id,
        token_kind: response.token_kind,
        expires_at: response.expires_at,
        quota_per_hour: response.quota_per_hour,
      });
    },
  };
}
