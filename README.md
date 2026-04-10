# StayFinder

OpenClaw plugin for live hotel and vacation rental search. Ask your agent for a hotel and get back real prices, real availability, and real booking redirect links. No web scraping. No browser automation. No fabricated URLs.

## Install

```bash
openclaw plugins install @riverintel/stayfinder
```

Add the tools to your `~/.openclaw/openclaw.json`:

```json
{
  "tools": {
    "alsoAllow": ["search_stays", "stayfinder_signup", "stayfinder_verify"]
  }
}
```

Restart the gateway:

```bash
openclaw gateway restart
```

## How it works

Ask your agent about hotels or vacation rentals:

> "Find me a hotel in Manhattan for next weekend, two adults"

The first time, the agent walks you through a one-time setup — it asks for your email, sends you a 6-digit code, and you paste the digits back into the chat. The whole thing takes about two minutes. After that, searches just work.

Your access stays active as long as you keep using it. If you go about a week without searching, the agent sends you a fresh code automatically — you don't have to re-enter your email.

## What you get back

The agent presents real-time results from Expedia and Vrbo with prices, ratings, and direct booking links:

> **The Plaza** ⭐⭐⭐⭐⭐ · 9.0/10 (1,000 reviews)
> $1,258/night · $2,894 total
> Iconic NYC landmark on Central Park & 5th Ave. Full-service spa, family-friendly.
> 👉 [Book on Expedia](https://expedia.com/r/...)

You can refine with follow-ups like "only 5-star", "pet-friendly", "under $300/night", or "show me vacation rentals instead" — the agent re-searches with updated filters each time.

## Tools

| Tool | Purpose |
|------|---------|
| `search_stays` | Search hotels and vacation rentals with filters, sorting, and an optional trip-intent description |
| `stayfinder_signup` | Send a 6-digit verification code to your email (first-time setup or re-auth) |
| `stayfinder_verify` | Exchange the code for an API token, saved automatically to your credential store |

The bundled `lodging-search` skill tells the agent when and how to use each tool — including the setup flow, re-authentication after inactivity, error handling, and output formatting.

## Configuration

All configuration is optional. The plugin defaults to the public hosted StayFinder service and US pricing.

```json
{
  "plugins": {
    "entries": {
      "stayfinder": {
        "enabled": true,
        "config": {
          "adapter_url": "https://api.stayfinder.riverintel.com",
          "default_pos_country": "US",
          "default_currency": "USD",
          "request_timeout_ms": 10000
        }
      }
    }
  }
}
```

Self-hosters can point `adapter_url` at their own deployment.

## Privacy

StayFinder receives the search parameters needed to find lodging — destination, dates, party size, filters, and (optionally) a one-sentence description of what kind of trip you're planning. It does not see your browsing history, the rest of your conversation with the agent, or anything you didn't tell the agent about your trip.

Your email address is used once during signup verification and stored only as a tenant identifier on the StayFinder service. The API token is written to `~/.openclaw/credentials/stayfinder.json` (mode 0600, readable only by you) and is never shown to the user or the agent.

## Issues and contributions

Bug reports, feature requests, and PRs welcome at [github.com/RiverIntel/stayfinder/issues](https://github.com/RiverIntel/stayfinder/issues).

## License

Apache 2.0 — see [LICENSE](./LICENSE).
