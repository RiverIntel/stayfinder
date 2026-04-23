---
name: lodging-search
description: Search live hotel and vacation rental inventory via StayFinder. Use for any lodging query — hotels, vacation rentals, accommodations for specific dates. Also handles first-time setup and re-authentication when the user needs a fresh API token.
---

# Lodging Search

When the user asks about hotels, vacation rentals, accommodations, "places to stay", or anywhere they could spend the night for a trip, **use the `search_stays` tool**.

## First-time setup

If `search_stays` returns an `unauthorized` error, the plugin isn't configured yet. The user needs to sign up. Walk them through it:

1. **Tell the user what's happening:** *"Looks like StayFinder isn't set up yet. I can take care of that — what email should I use to sign you up?"*

2. **Once they give you an email, call `stayfinder_signup({email: "..."})`.** This sends them a 6-digit code.

3. **Tell them to check their inbox:** *"Sent! Check **{email}** for a message from StayFinder. It contains a 6-digit code — paste those six digits back here when you have them. The code expires in 15 minutes."*

4. **When they paste the code** (six digits, possibly with stray spaces — that's fine, the tool strips them), **call `stayfinder_verify({email: "...", code: "..."})`.** The tool exchanges the code for an API token and saves it automatically. **You never see the token. The user never sees the token.**

5. **Confirm setup worked:** *"You're set up with a search quota of {quota} per hour. Your access will stay active as long as you keep using it (re-auth after a week of inactivity). Want me to run that hotel search now?"*

6. **Then run their original lodging search** with `search_stays`.

## Re-authentication (token expired)

If `search_stays` returns `token_expired`, the user's previous token has aged out from inactivity (~7 days without a search). The plugin already knows their email — **don't ask for it again**. Just send a fresh code:

1. **Tell the user what happened, briefly:** *"Your StayFinder access expired because you haven't searched in a while. I'll send a fresh code to **{email}** — paste the 6 digits back here."*

   The email is available from the tool's error context or from the cached credential file. Do NOT ask the user "what was your email again?"

2. **Call `stayfinder_signup({email: <cached email>})`** without prompting the user for input.

3. **Wait for the user to paste the 6 digits, then call `stayfinder_verify`** with the same email.

4. **On success, immediately re-run the original `search_stays` call** that triggered the `token_expired` error. The user shouldn't have to repeat their hotel query.

The whole re-auth detour should feel like a 30-second pause, not a setup ritual.

## Setup edge cases

- **`stayfinder_verify` returns `code_invalid`:** *"That code didn't match. You have {attempts_remaining} tries left. Could you double-check the email — it's a 6-digit number from StayFinder."* Wait for them to retry.

- **`stayfinder_verify` returns `code_expired`:** *"That code already expired (15 min limit). I'll send a fresh one."* Then call `stayfinder_signup` again with the same email.

- **`stayfinder_verify` returns `code_attempts_exceeded`:** *"Too many wrong codes — that one's locked. Sending a fresh code now."* Then call `stayfinder_signup` again with the same email.

- **`stayfinder_signup` returns `disposable_email`:** *"That email provider isn't accepted. Could you use a different email address?"*

- **`stayfinder_signup` returns `invalid_email`:** *"That doesn't look like a valid email address. Could you double-check it?"*

- **`stayfinder_signup` returns `signup_rate_limited`:** *"Too many signup attempts in the last day. Try again in {N} minutes, or use a different email."*

- **The user pastes something that isn't 6 digits** (e.g., they paste a long token, or a date, or a phrase): *"I just need the 6-digit code from the email — six numbers, like 473829. Could you copy just that part?"*

- **The user gives up halfway through:** That's fine. Tell them they can come back later — the next time they ask about lodging, you'll pick up where you left off.

## When to use search_stays

Triggers include:
- "Find me a hotel in X"
- "What's a good place to stay in Y?"
- "Compare hotels for these dates"
- "Vacation rentals in Z for a family of four"
- "How much are hotels in NYC next month?"
- "Show me pet-friendly hotels"
- Any follow-up like "cheaper options" or "with free cancellation" after a previous lodging search

## How to use search_stays

1. **Get the required fields first.** You need:
   - `destination` (free text — be as specific as the user is; don't over-narrow)
   - `check_in` and `check_out` (YYYY-MM-DD)
   - `adults` (number of adult guests)

2. **Ask for missing required fields** before calling the tool. Don't guess dates. Don't assume party size. A typical follow-up: *"What dates are you looking at, and how many guests?"*

3. **Set the `intent` field** when the user has expressed a clear trip purpose, vibe, or constraint — for example, "romantic anniversary weekend", "business trip with early meetings", "family vacation with two kids under 10", "wedding weekend, need to be near downtown." Leave it blank for purely transactional searches where the user just gave you destination, dates, and party size with no context.

4. **Call search_stays** with the gathered fields plus any filters the user mentioned (pet-friendly, price range, star rating, free cancellation, etc.).

5. **If the search returns zero results**, try these before giving up:
   - Use a more specific destination (e.g., "Kihei, Maui" instead of "Maui") — the service resolves free-text destinations and specific town names work better than broad region names
   - For vacation rentals in resort/rural areas, the inventory may be spread across a wider area than city hotels — some destinations just have limited coverage
   - Tell the user honestly if nothing came back and suggest a nearby alternative or different dates

6. **Present 3-5 top options** to the user, not all 25. Focus on price, location, and the most distinctive feature. Include the redirect_link for each so the user can book.

7. **For follow-ups** ("cheaper", "more central", "with a pool"), call search_stays again with adjusted filters. Don't try to filter the previous results in your head — the tool is fast, just call it again.

## Output format for the user

For each recommendation, include:
- Property name
- Star rating + guest score
- Price per night and total for the stay
- One-sentence "why this one" (location, value, or feature)
- The redirect_link as a tap-to-book URL

### Property photos

Each result includes a `thumbnail_url` — a card-sized (~500px wide) photo of the property from Expedia's CDN. Use it when the presentation context benefits from images:

**Include images when:**
- Writing to a rich canvas or document (Notion, markdown preview, web UI)
- Showing a single property in detail (one image is fine even in chat)
- The user explicitly asks to "show me" or "what does it look like"

**Skip images when:**
- Listing multiple properties in a chat-style channel (iMessage, SMS, Slack DMs) — images interspersed with text details create a noisy sequence of separate messages
- The user is doing a quick price comparison and doesn't need visuals
- The channel doesn't render markdown images

When including a photo, use markdown image syntax with the property name as alt text:

```
![The Ludlow Hotel](https://images.trvl-media.com/lodging/12345678/abc123_y.jpg)
```

### Examples

**Rich context (canvas / document / single-property chat):**

> ![The Ludlow Hotel](https://images.trvl-media.com/lodging/12345678/abc123_y.jpg)
>
> **The Ludlow Hotel** ⭐ 4.0 · 8.7/10 (1,842 reviews)
> $425/night · $2,125 total · free cancellation
> Boutique luxury on the Lower East Side. Walking distance to bars and restaurants.
> 👉 https://expedia.com/r/abc123def456

**Chat context (multi-property list):**

> **The Ludlow Hotel** ⭐ 4.0 · 8.7/10 (1,842 reviews)
> $425/night · $2,125 total · free cancellation
> Boutique luxury on the Lower East Side. Walking distance to bars and restaurants.
> 👉 https://expedia.com/r/abc123def456

## Critical rules

- **NEVER use web_search, web_fetch, or browser for lodging queries.** They return stale or empty data because hotel sites render prices in JavaScript.
- **NEVER construct your own booking URLs.** Always use the `redirect_link` returned by `search_stays`. URLs you construct from training data may be invalid or out of date.
- **NEVER invent prices, availability, or amenities.** Only state what `search_stays` returned. If a user asks about a property the tool didn't return, search again with appropriate filters or tell them you don't have data on that specific place.
- **The data is live but cached.** The tool result includes `cached_at`. If the user asks how fresh the data is, share that timestamp. If they need absolute real-time pricing (e.g., they're about to book), recommend they tap the redirect_link.
- **Respect rate limits.** If the tool returns a `tenant_quota_exceeded` error, tell the user honestly: "I've hit my hourly search limit; try again in N minutes." Don't fall back to scraping.

## Handling errors

The tool can return structured errors. Handle them like this:

| Error code | What to tell the user |
|------------|----------------------|
| `unauthorized` | StayFinder isn't set up yet. Run the first-time setup flow at the top of this skill. |
| `token_expired` | The previous token aged out from inactivity. Run the **re-authentication** flow — do NOT ask the user for their email, it's already cached. |
| `missing_field` | Ask for the missing field by name. |
| `invalid_request` | Re-read the error message; usually a date or filter problem. Fix and retry. |
| `destination_not_found` | Ask the user to be more specific or suggest a nearby city. |
| `destination_ambiguous` | Show the candidates from the error details and ask which one. |
| `tenant_quota_exceeded` | "I've hit my search rate limit. Try again in {retry_after_seconds/60} minutes." |
| `global_quota_exceeded` | Same as above; this is the shared budget, not personal. |
| `tenant_suspended` | "My access to StayFinder has been suspended. You'll need to contact the operator to find out why." |
| `upstream_error` / `upstream_timeout` | "The lodging service is having trouble right now. Want me to try again in a minute?" |

Always include the actual error message in your reply if it's user-friendly. Don't paraphrase technical errors into vagueness.
