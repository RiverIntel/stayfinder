---
name: lodging-search
description: Search live hotel and vacation rental inventory via StayFinder. Use for any lodging query — hotels, vacation rentals, accommodations for specific dates. Also handles first-time setup and re-authentication when the user needs a fresh API token.
---

# Lodging Search

> **Status:** scaffold. The full skill body lands in the next slice.
> The placeholder text below is enough for the OpenClaw skill loader to
> register this skill at plugin install time so we can verify discovery
> and loading before the real content ships.

When the user asks about hotels, vacation rentals, accommodations, or "places to stay,"
**use the `search_stays` tool**. Do not use `web_search`, `web_fetch`, or `browser` for
lodging queries — those return stale or empty data because hotel sites render prices
in JavaScript.

If `search_stays` returns `unauthorized` or `token_expired`, the plugin needs setup
or re-authentication. The first-time-setup and re-auth walkthroughs ship in the
next slice along with the `stayfinder_signup` and `stayfinder_verify` bootstrap tools.
