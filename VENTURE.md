---
slug: draft-off
stage: launched
priority: 4
url: https://pb-draft-off.jan-bef.workers.dev
repo: https://github.com/janwan2003/draft-off
updated: 2026-11-21
---

# draft-off

## Thesis

**Who:** Group chats that argue about things: "best Christmas movies", "best snacks", "best Tom
Cruise films", "best 2000s songs", "best pizza toppings". Friends, families, coworkers, sports and
podcast fans. The "draft" format (take turns picking from a pool, then judge whose list is best)
is familiar from fantasy sports and from podcasts and media pieces that "draft" anything.

**What:** A no-login "draft anything" game for a group chat. One person picks a topic, the number
of drafters (2–6) and rounds (3–8), and shares the link. Drafters join with a nickname and take
turns picking in snake order, asynchronously (a per-pick timer, e.g. 2 hours, with autopick from a
suggested pool if someone sleeps). Everyone else in the chat joins as a voter. When the draft ends,
the group votes on the best team; results unlock when voting closes. The final boards plus the
vote result render as a card.

**Needs others:** yes. You cannot draft against yourself, and the winner is decided by the group.

**Viral moment:** the final board card ("Ola's team won 'best Christmas movies' 7–3; Kevin
picked Die Hard in round 1") posted to the chat and to stories, and the arguments it starts. Link
preview: "Round 4 of 6 · Kevin on the clock". After the vote: "Draft another topic" and
"Challenge another group with this topic".

**How often:** whenever a debate starts, which is weekly in active group chats. Seasonal topics
(Christmas movies, Super Bowl snacks, summer songs) give constant reasons.

**Why now:** the draft format is mainstream (fantasy sports; [The Ringer's "Chronically Online
Draft"](https://www.theringer.com/2025/12/30/pop-culture/internet-main-characters-2025-coldplay-kiss-cam-jordon-hudson)),
and its makers report it starts in WhatsApp debates. The only general-purpose tools are tiny
(Product Hunt pages with 7 and 18 followers), so the category is open.

## Market evidence

Searches run 2026-11-20. Sources are search-result summaries, not opened pages. No search-volume
or install numbers found; the demand case is qualitative.

- **Direct small competitors:** SnakeDrafts (iOS/Android app; "Draft anything. Let AI decide the
  winner"; co-creator says it started from a WhatsApp debate about the best Tom Cruise movies;
  18 Product Hunt followers) ([Product Hunt](https://www.producthunt.com/products/snakedrafts-on-ios-android));
  GetDraftedNow (web, no accounts, magic-link invites, per-pick timers, snake/linear/auction;
  7 followers, no reviews) ([Product Hunt](https://www.producthunt.com/p/getdraftednow)).
  Flash Draft was a Messenger fantasy football game ([Product Hunt](https://www.producthunt.com/posts/flash-draft-on-facebook-messenger)).
- **Format familiarity:** ESPN runs live online snake drafts for fantasy leagues
  ([ESPN support](https://support.espn.com/hc/en-us/articles/360000067532-Live-Online-Snake-Drafts));
  media draft pieces such as The Ringer's above.
- **Weaknesses of what exists:** SnakeDrafts is an install for every drafter, and AI judges
  replace the group's own vote (the group vote is the fun part). GetDraftedNow is built as a
  generic draft utility (paste a list) without group voting, result cards or topic packs.
- **Sanity check 2026-11-21** (two standard web searches; search-result summaries, pages not opened):
  SnakeDrafts' App Store listing confirms "Draft anything", hundreds of topics, AI judges with optional human
  judges, and the WhatsApp-debate origin ([App Store](https://apps.apple.com/us/app/id6748621688)).
  [Screen Drafts](https://podcasts.apple.com/us/podcast/screen-drafts/id1431963108) is a whole podcast built on
  the format, and Movie Drafter is another small Product Hunt entry. Still no search-volume or install numbers.
  Conclusion: the format is familiar and every tool that exists is small or needs an app. Demand at scale is
  unproven, but the sharing loop does not depend on search, so it was worth building.
- **How people do it now:** typing picks into the group chat in turn and arguing; polls in
  WhatsApp/Instagram for the verdict (observed in competitors' origin stories, not measured).

## Our edge

- **Loop: needs others.**
- **K estimate ≈ 1.6** = 8 people invited per draft (3–4 drafters plus the rest of the chat as
  voters) × 65% who join (voting is one tap) × 30% of joiners who later start a draft on their own
  topic, in this group or another. Reason: drafts are short (a day) and topics are endless, so
  repeat creation is easy; voters see "draft another topic" right after the result.
- **Group decides the winner** (not AI), with results that unlock when voting closes.
- **Async snake draft** with per-pick timers and autopick so nobody blocks the chat.
- **Topic packs** with suggested pools (films, foods, songs, sports players) using public data
  (e.g. Wikidata) so picks have names and images without manual typing; free-text picks allowed.
- **Honest risk:** the existing small tools show the idea is easy to copy; win on polish, the
  result card and topic packs. Picks of copyrighted posters/images: use text or public-domain
  images only.

## Status

**Live: https://pb-draft-off.jan-bef.workers.dev** (Cloudflare Worker `pb-draft-off`, free plan). Product,
support and privacy page: https://janwan2003.github.io/draft-off/ . Search Console: verified (META) and
sitemap submitted 2026-11-21 (`scripts/gsc.py`).

**Why a Worker and not Pages + D1:** `wrangler d1 create pb-draft-off` failed on 2026-11-21 with "You have reached
the maximum number of D1 databases for your account". Each draft is therefore one Durable Object with its own
SQLite database (`schema.sql`, wrapped in a small D1-style shim in `src/worker.js`). A `Limiter` Durable Object
rate-limits per IP hash (create 20/h, join 60/h, writes 900/h). The same approach as party-game-night.

What exists (vanilla JS, no build step):
- Home: 30 topic packs in 6 groups (Holiday first), with 40–50 suggestions each; a custom topic with optional
  pasted suggestions; picks each (3–8); time per pick (none, 5 min, 1 h, 3 h, 12 h); name. Also How it works,
  FAQ, and "Your drafts" on this device. `/?t=<slug>` or `/?title=` pre-fill the form.
- Draft page `/d/<id>`:
  - Lobby: join as drafter (2–8) or voter; duplicate-name check; host settings; random or join order.
  - Draft: snake board with "on the clock"; a pick box with autocomplete that marks taken items; duplicate picks
    blocked, ignoring case, accents, punctuation and a leading "the"; picks stored under the suggestion's
    spelling; countdown; autopick or skip when the clock runs out (lazy, on the next request); "Nudge" and
    "Message <next drafter>" share buttons; take back your own last pick; host "Pick for X" and undo.
  - Voting: vote for the best team (not your own) plus an optional "pick of the draft". Late voters join with a
    name inline. Tallies stay hidden, in the API too, until 24 h after the last pick or until the host reveals.
  - Result: winner hero, vote bars, a ⭐ pick of the draft, a result card PNG (1080 wide, 1080–1350 tall; share
    sheet or download), "Draft another topic" and "Run this topic in another group".
  - Also: people list, private link (`#k=token`), leave, remove, delete.
- Link preview per draft (`src/og.js`) with live state: "Draft: X · N drafters so far", "Round 2 of 3 · Kevin on
  the clock / Last pick: Sam took Klaus", "Vote for the best team · N votes so far", "🏆 Sam's team won … 3–1 on
  4 votes". Static og.png.
- Safety: tokens stored as SHA-256; same-origin check on writes; CSP and security headers (Worker plus
  `_headers`); caps (8 drafters, 120 people, 60-character picks, 80-character titles); drafts self-delete after
  180 days (Durable Object alarm).

Verified 2026-11-21:
- `node --test tests/unit/*.test.js`: 11/11 pass (snake order, one pick per drafter per round, norm and
  duplicates, autopick, pool parsing, on-the-clock, catch-up of expired clocks, tally with ties, pick of the
  draft, and the topic-pack format: 30 slugs, 36–50 items, no duplicates under `norm()`).
- `tests/e2e/run.mjs`, real Chromium with 5 browser contexts (host on desktop at 1280 px, three phones at 390 px,
  one laptop at 1024 px). **Passes locally (with a 4 s test clock) and on production** (version 8f6907c7, without
  the clock step). It checks: topic chip, empty-title error, join as drafter and voter, duplicate name 409, start
  in join order, live "your pick" without reload, autocomplete, duplicate pick, pool spelling, take back, snake
  double pick, host pick-for, voting with self-vote blocked, late voter, tally hidden in the API, reveal,
  winner and pick of the draft on every page, OG text at all 4 stages, result card PNG, challenge link pre-fill,
  "Your drafts", the expired-clock autopick (local), and delete (gone plus API 404). It also checks for no
  horizontal overflow and zero unexpected console errors.
- Live: `/`, `/privacy`, robots, sitemap, og.png, icons and manifest return 200; an unknown path returns 404; CSP
  and X-Frame-Options are present on static pages.
- Screenshots checked by eye: home desktop and phone, pick phone, vote phone, result phone, result card. Found and
  fixed:
  - A poll re-render reset the "Random order" checkbox, so the draft started shuffled.
  - The pick box kept the old text after a pick.
  - Phone cards overflowed the right edge (grid min-content).
  - "R1" labels wrapped.
  - The result card cut off long titles and wasted space.
- **Not tested:** real phones, WhatsApp or iMessage previews, in-app browsers. The share sheet was only exercised
  through its download fallback.

## Metrics

- 2026-11-21: 0 real drafts (launch day; the only drafts created were e2e runs, which delete themselves).

## Next steps

1. Operator seed (in the inbox): run one real draft in a real group chat, ideally "Best Christmas movies" before
   December, and record what was slow or confusing here.
2. Push updates instead of polling: the Durable Object can hold hibernating WebSockets. Polling (every 4 s while
   drafting, every 10 s otherwise, paused when hidden) uses the free plan's 100k requests a day, which is about
   110 tab-hours of a live draft.
3. Dynamic OG image per draft (the board as a picture) for a richer chat preview.
4. Optional "it's your turn" web push for drafters who allow it, the main pain point of async drafts.
5. SEO landing pages per topic (`/topics/christmas-movies`) with the pool as a list, pointing into "Start this
   draft".
6. Add a weekly count script (drafts, drafters, voters) for `## Metrics`. Durable Objects cannot be listed, so
   this needs a small counter object or Workers Analytics.

## Monetization plan

None until the operator enables it (charter rule 4). Later: premium topic packs, bigger drafts,
creator/podcast mode for audiences. Never paywall joining or voting.

## Log

- 2026-11-20 scout: created idea. Evidence from web searches (Product Hunt pages, ESPN support,
  The Ringer). No volume data; competitors are tiny, so demand is unproven at scale.
- 2026-11-21 builder: sanity-checked evidence (2 searches), then built and launched. Engine, API (Worker plus a
  Durable Object per draft, because the D1 limit is reached), UI, 30 topic packs (written by a subagent, checked
  by a unit test), result card, live OG text. Deployed https://pb-draft-off.jan-bef.workers.dev, GitHub Pages,
  Search Console verified and sitemap submitted. Evidence: unit 11/11; e2e PASS locally and on production. Five
  UI bugs found from screenshots and fixed (see Status).
