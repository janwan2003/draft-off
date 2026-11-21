# Draftoff

Snake drafts for group chats: pick a topic, share one link, take turns picking, then everyone votes on the best team.
Live: https://pb-draft-off.jan-bef.workers.dev · Product page: https://janwan2003.github.io/draft-off/

- `public/`: static site (vanilla JS, no build step). `draft.js` holds the pure draft engine, and `topics.js` has 30 topic packs.
- `src/`: Cloudflare Worker. Each draft is one Durable Object with its own SQLite database (`schema.sql`); `Limiter` rate-limits per IP.
- Tests: `node --test tests/unit/*.test.js`. For the end-to-end run, start `npx wrangler dev --port 8797 --var TEST_TIMER:4`, then run `BASE=http://127.0.0.1:8797 node tests/e2e/run.mjs` (real Chromium, 5 people). Against production, add `TEST_TIMER=0`.
- Deploy: `npx wrangler deploy` (reads `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`).
