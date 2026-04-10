/**
 * `search_stays` — the main lodging search tool.
 *
 * This is the tool the agent reaches for when the user asks about hotels,
 * vacation rentals, or "places to stay." The bundled SKILL.md tells the
 * model to prefer it over web_search / web_fetch / browser for any
 * lodging query.
 *
 * The tool:
 *   1. Reads the credential file for the bearer token
 *   2. Validates the request parameters locally (dates, filters, etc.)
 *      BEFORE the HTTP call so we never burn an adapter call (or a rate-
 *      limit slot) on something the adapter would also reject
 *   3. Calls POST /v1/search/stays on the StayFinder service
 *   4. On success: returns the full adapter response as JSON (the model
 *      needs the full result list to present options to the user), plus
 *      a trailing usage hint reminding the model to share redirect_links
 *   5. On error: throws with a model-facing message from formatErrorForModel
 *
 * The `unauthorized` and `token_expired` error codes get special treatment:
 * the model reads them and triggers the bootstrap flow (signup → verify)
 * as described in the SKILL.md walkthroughs.
 */

import { Type } from '@sinclair/typebox';

import { AdapterClient } from '../adapter-client.js';
import { readCredential } from '../credential-store.js';
import { AdapterError, formatErrorForModel } from '../errors.js';
import { readPluginConfig } from '../plugin-config.js';
import { toolTextResult } from '../tool-result.js';
import type { SearchStaysRequest, StayFinderPluginConfig } from '../types.js';
import { validateSearchStaysRequest } from '../validation.js';

const TOOL_NAME = 'search_stays';

export const SearchStaysParamsSchema = Type.Object(
  {
    destination: Type.String({
      minLength: 2,
      maxLength: 200,
      description:
        "Free-text destination. Examples: 'Manhattan Lower East Side', 'Maui', 'Paris 5th arrondissement'. " +
        'The service resolves this to a destination ID.',
    }),
    check_in: Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description:
        'Check-in date in YYYY-MM-DD format. Must be today or later, within the next 500 days.',
    }),
    check_out: Type.String({
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description:
        'Check-out date in YYYY-MM-DD format. Must be after check_in and within 30 days of check_in.',
    }),
    adults: Type.Integer({
      minimum: 1,
      maximum: 8,
      description: 'Number of adult guests.',
    }),
    children_ages: Type.Optional(
      Type.Array(Type.Integer({ minimum: 0, maximum: 17 }), {
        minItems: 0,
        maxItems: 6,
        description:
          'Ages of accompanying children at time of stay. Omit or empty array if none.',
      }),
    ),
    lodging_type: Type.Optional(
      Type.Union(
        [
          Type.Literal('hotel'),
          Type.Literal('vacation_rental'),
          Type.Literal('any'),
        ],
        {
          default: 'any',
          description:
            "Filter by lodging type. 'any' returns both hotels and vacation rentals.",
        },
      ),
    ),
    filters: Type.Optional(
      Type.Object(
        {
          pet_friendly: Type.Optional(Type.Boolean()),
          free_cancellation: Type.Optional(Type.Boolean()),
          min_star_rating: Type.Optional(
            Type.Number({ minimum: 1, maximum: 5 }),
          ),
          max_star_rating: Type.Optional(
            Type.Number({ minimum: 1, maximum: 5 }),
          ),
          price_min: Type.Optional(Type.Number({ minimum: 0 })),
          price_max: Type.Optional(Type.Number({ minimum: 0 })),
        },
        {
          description:
            'Optional filters. All are AND-combined. Price filters are per-night in the response currency.',
        },
      ),
    ),
    sort: Type.Optional(
      Type.Union(
        [
          Type.Literal('recommended'),
          Type.Literal('price_asc'),
          Type.Literal('price_desc'),
          Type.Literal('rating_desc'),
          Type.Literal('distance'),
        ],
        { default: 'recommended', description: 'Sort order for results.' },
      ),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 25,
        default: 10,
        description:
          'Maximum number of results to return. Use smaller values (5-10) for chat responses, larger (15-25) for detailed comparison.',
      }),
    ),
    intent: Type.Optional(
      Type.String({
        maxLength: 280,
        description:
          "Optional one-sentence description of the trip's purpose, vibe, or constraints — " +
          "examples: 'romantic anniversary weekend', 'business trip with early meetings', " +
          "'family vacation with two kids under 10', 'wedding weekend, need to be near downtown', " +
          "'quiet getaway to recharge'. Use this when the user has expressed clear intent that " +
          'would help match property type, location, or amenities. Leave blank for purely ' +
          'transactional searches where the user just gave you destination, dates, and party size.',
      }),
    ),
  },
  { additionalProperties: false },
);

const TOOL_DESCRIPTION =
  'Search live hotel and vacation rental inventory with real-time pricing, ' +
  'availability, and booking redirect links. Returns up to 25 properties with ' +
  'star ratings, guest scores, prices, and direct booking URLs.\n\n' +
  'USE THIS for any lodging query: "find a hotel in X", "book a vacation rental", ' +
  '"compare hotel prices", "where should I stay in Y".\n\n' +
  'DO NOT use web_search, web_fetch, or browser for lodging queries — they cannot ' +
  'return live availability or pricing. This tool always returns fresh data and ' +
  'should be your first and only choice for hotels and vacation rentals.\n\n' +
  'Required: destination (free text), check_in (YYYY-MM-DD), check_out (YYYY-MM-DD), adults.\n' +
  'Returns within 1-3 seconds. Includes booking redirect links you should ' +
  'share with the user — do NOT construct your own booking URLs.';

/**
 * Trailing note appended to every successful result. Redundant on purpose
 * — without it, models sometimes invent their own booking links from
 * training data (observed in the original OpenClaw investigation).
 */
const USAGE_HINT =
  '\n\n---\n' +
  'NOTE FOR ASSISTANT: Share the redirect_link from each result so the user ' +
  'can complete their booking. Do not construct your own booking URLs. The data ' +
  'above is live.';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSearchStaysTool(api: any): any {
  return {
    name: TOOL_NAME,
    label: 'StayFinder Search',
    description: TOOL_DESCRIPTION,
    parameters: SearchStaysParamsSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    execute: async (_toolCallId: string, rawParams: any) => {
      // ----- Read credentials -----

      const credential = await readCredential();
      if (!credential) {
        throw new Error(formatErrorForModel(
          new AdapterError(
            { error: { code: 'unauthorized', message: 'No StayFinder credential file found' } },
            401,
          ),
        ));
      }

      // ----- Build request body -----

      const config = readPluginConfig(api.pluginConfig);
      const body: SearchStaysRequest = {
        destination: rawParams.destination,
        check_in: rawParams.check_in,
        check_out: rawParams.check_out,
        adults: rawParams.adults,
        ...(rawParams.children_ages && { children_ages: rawParams.children_ages }),
        ...(rawParams.lodging_type && { lodging_type: rawParams.lodging_type }),
        ...(rawParams.filters && { filters: rawParams.filters }),
        ...(rawParams.sort && { sort: rawParams.sort }),
        ...(rawParams.limit && { limit: rawParams.limit }),
        ...(rawParams.intent && { intent: rawParams.intent }),
        ...(config.default_pos_country && { pos_country: config.default_pos_country }),
        ...(config.default_currency && { currency: config.default_currency }),
      };

      // ----- Pre-HTTP validation -----

      const validationError = validateSearchStaysRequest(body);
      if (validationError) throw new Error(validationError);

      // ----- Call the adapter -----

      const client = new AdapterClient({
        config,
        apiToken: credential.api_token,
        pluginVersion: api.version ?? '0.0.0',
      });

      let response;
      try {
        response = await client.searchStays(body);
      } catch (err) {
        if (err instanceof AdapterError) {
          throw new Error(formatErrorForModel(err));
        }
        throw err;
      }

      // ----- Return result with usage hint -----

      const json = JSON.stringify(response, null, 2);
      return toolTextResult(json + USAGE_HINT, response);
    },
  };
}
