/**
 * StayFinder OpenClaw plugin entry point.
 *
 * Registers three tools:
 *   - search_stays      — live hotel and vacation rental search
 *   - stayfinder_signup — request a 6-digit email verification code
 *   - stayfinder_verify — exchange the code for a token, saved to disk
 *
 * The bundled SKILL.md in skills/lodging-search/ tells the model when
 * and how to use these tools. The skill is loaded automatically by
 * OpenClaw when the plugin is installed (declared in openclaw.plugin.json).
 */
import { definePluginEntry } from 'openclaw/plugin-sdk/core';

import { createSearchStaysTool } from './tools/search-stays.js';
import { createStayFinderSignupTool } from './tools/stayfinder-signup.js';
import { createStayFinderVerifyTool } from './tools/stayfinder-verify.js';

export default definePluginEntry({
  id: 'stayfinder',
  name: 'StayFinder',
  description:
    'Live hotel and vacation rental search via the StayFinder service. ' +
    'Returns real-time pricing, availability, and booking redirect links.',
  register(api) {
    api.registerTool(createSearchStaysTool(api));
    api.registerTool(createStayFinderSignupTool(api));
    api.registerTool(createStayFinderVerifyTool(api));
  },
});
