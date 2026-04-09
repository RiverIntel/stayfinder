/**
 * StayFinder OpenClaw plugin entry point.
 *
 * This file is the canonical extension entry — `package.json#openclaw.extensions`
 * points at `./dist/index.js`, which is the compiled output of this file.
 *
 * The plugin currently registers nothing functional; it's a scaffold that
 * loads cleanly into the OpenClaw plugin runtime so we can verify the
 * package layout, version compatibility, and ClawHub publish flow before
 * adding real tools.
 *
 * Subsequent slices will add (in roughly this order):
 *   - search_stays      — the main lodging search tool
 *   - stayfinder_signup — bootstrap tool that requests a 6-digit email code
 *   - stayfinder_verify — bootstrap tool that exchanges the code for a token
 *   - skills/lodging-search/SKILL.md — the mandatory companion skill
 *   - credential store, error mapping, etc.
 */
import { definePluginEntry, emptyPluginConfigSchema } from 'openclaw/plugin-sdk/core';

export default definePluginEntry({
  id: 'stayfinder',
  name: 'StayFinder',
  description:
    'Live hotel and vacation rental search via the StayFinder service. ' +
    'Returns real-time pricing, availability, and Expedia booking redirect links.',
  configSchema: emptyPluginConfigSchema(),
  register: (_api) => {
    // Intentionally empty for the scaffold slice. Tool registrations land
    // in the next slice; see src/tools/ for the planned shape.
  },
});
