# StayFinder

OpenClaw plugin for live hotel and vacation rental search via the
[StayFinder service](https://api.stayfinder.riverintel.com).

> **Status: early scaffold.** Functional tool surface (`search_stays`,
> `stayfinder_signup`, `stayfinder_verify`) ships in the next release.
> The first published version is intentionally a no-op so we can verify
> the package layout, version compatibility, and ClawHub publish flow
> before adding real tools. Star the repo or watch releases to know
> when v0.1.0 ships.

## What it does (when v0.1.0 lands)

Gives your OpenClaw agent a single, well-described tool — `search_stays` —
backed by real Expedia and Vrbo inventory. Ask your agent for a hotel and
get back real prices, real availability, and real booking redirect links.
No web scraping. No browser automation. No fabricated URLs.

Out of the box, the plugin replaces `web_search` / `web_fetch` / `browser`
for any lodging query. The bundled `lodging-search` skill aggressively
nudges the model to reach for `search_stays` first.

## Installation

```bash
openclaw plugins install @riverintel/stayfinder
```

OpenClaw checks ClawHub first, then falls back to npm.

## Setup

After installing, add `search_stays` to your `tools.alsoAllow` list in
`~/.openclaw/openclaw.json` and restart the gateway:

```json
{
  "tools": {
    "profile": "coding",
    "alsoAllow": ["search_stays"]
  }
}
```

The first time you ask your agent for a hotel, it will walk you through
a 6-digit email verification flow to issue you an API token. The token
is bound to a 7-day sliding inactivity window — as long as you keep
searching, it never expires.

The plugin defaults to the public hosted StayFinder service at
`https://api.stayfinder.riverintel.com`. Self-hosters can override
`adapter_url` in plugin config to point at their own deployment.

## Privacy

The plugin sends only what's needed to perform a lodging search:
destination, check-in/out dates, party size, and any filters you
specify. Your email address is sent once during signup verification
and stored only as a tenant identifier on the StayFinder service.
No browsing history, no personal data, no tracking.

## Issues and contributions

This is an early-stage project. Bug reports, feature requests, and PRs
all welcome at [github.com/RiverIntel/stayfinder/issues](https://github.com/RiverIntel/stayfinder/issues).

## License

Apache 2.0 — see [LICENSE](./LICENSE).
