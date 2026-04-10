/**
 * `stayfinder_signup` bootstrap tool.
 *
 * Drives the first step of the StayFinder onboarding flow: takes an email
 * address from the agent, fires `POST /v1/signup` against the service,
 * and returns a friendly "check your inbox for a 6-digit code" message.
 *
 * This tool is unauthenticated — it does NOT read or use a credential
 * file. The agent calls it both for first-time setup (after `unauthorized`)
 * and for re-authentication (after `token_expired`). In the re-auth case,
 * the agent should pass the email it already has from the cached
 * credential record, NOT prompt the user for it again — the bundled
 * SKILL.md tells the model how to do this.
 *
 * The companion tool `stayfinder_verify` accepts the 6-digit code the
 * user pastes back and writes the resulting token to disk. The agent
 * always calls them as a pair: signup → user reads email → verify.
 */

import { Type } from '@sinclair/typebox';

import { AdapterClient } from '../adapter-client.js';
import { toolTextResult } from '../tool-result.js';
import { AdapterError, formatErrorForModel } from '../errors.js';
import { readPluginConfig } from '../plugin-config.js';
import { validateEmailLoose } from '../validation.js';

const TOOL_NAME = 'stayfinder_signup';

/**
 * TypeBox schema for the tool's parameters. The model reads the
 * description fields when deciding how to call the tool, so they're
 * tuned for clarity and to nudge the model toward the right behavior
 * (especially for re-auth — see the email field's description).
 */
export const StayFinderSignupParamsSchema = Type.Object(
  {
    email: Type.String({
      minLength: 5,
      maxLength: 254,
      description:
        "The user's email address. A 6-digit verification code will be sent here. " +
        'For first-time setup, ask the user for their email and pass it. ' +
        'For RE-AUTHENTICATION (after a `token_expired` error), pass the email from the cached credential record — ' +
        'do NOT ask the user for their email again, it is already known.',
    }),
  },
  { additionalProperties: false },
);

const TOOL_DESCRIPTION =
  'Start the StayFinder signup flow. Sends a 6-digit verification code to the user\'s email. ' +
  'Use this when (a) the user wants to set up StayFinder for the first time, OR ' +
  '(b) search_stays returns `unauthorized` (plugin isn\'t configured), OR ' +
  '(c) search_stays returns `token_expired` (the previous token aged out from inactivity — re-auth with the cached email). ' +
  'After calling this, tell the user a 6-digit code is on its way and ask them to paste the digits back into the chat. ' +
  'Then call stayfinder_verify with the email and the code. ' +
  'For case (c) above, call this WITHOUT asking the user for their email first — the email is in the credential record.';

/**
 * Factory that builds the AnyAgentTool object the SDK's `api.registerTool`
 * accepts. Takes the plugin api so the tool can read pluginConfig and the
 * plugin version at execute time.
 *
 * Returns an AnyAgentTool-shaped object directly rather than reaching for
 * a typed import — the SDK ships .js without .d.ts for the helper, so
 * we type-erase at the boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createStayFinderSignupTool(api: any): any {
  return {
    name: TOOL_NAME,
    label: 'StayFinder Signup',
    description: TOOL_DESCRIPTION,
    parameters: StayFinderSignupParamsSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (_toolCallId: string, rawParams: any) => {
      const email = typeof rawParams?.email === 'string' ? rawParams.email.trim() : '';

      // Local validation first — fail fast on obvious garbage so we don't
      // burn an HTTP call (and a per-IP rate-limit slot on the adapter).
      const emailError = validateEmailLoose(email);
      if (emailError) {
        throw new Error(emailError);
      }

      const config = readPluginConfig(api.pluginConfig);
      const client = new AdapterClient({
        config,
        // No apiToken — signup is unauthenticated
        pluginVersion: api.version ?? '0.0.0',
      });

      let response;
      try {
        response = await client.signup(email);
      } catch (err) {
        if (err instanceof AdapterError) {
          throw new Error(formatErrorForModel(err));
        }
        // Network / timeout / unexpected — let the underlying message through
        throw err;
      }

      const message =
        `Sent! Check ${email} for a 6-digit code from StayFinder. ` +
        `Ask the user to paste the digits back here, then call stayfinder_verify with the email and code. ` +
        `The code expires in ${Math.round(response.expires_in_seconds / 60)} minutes.`;

      return toolTextResult(message, {
        status: response.status,
        email,
        expires_in_seconds: response.expires_in_seconds,
      });
    },
  };
}
