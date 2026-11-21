// Draftoff engine: snake order, timeouts with autopick, duplicate checks, vote tallies.
// Pure functions shared by the browser and the API (no DOM, no storage).

export const MIN_DRAFTERS = 2;
export const MAX_DRAFTERS = 8;
export const MIN_ROUNDS = 3;
export const MAX_ROUNDS = 8;
export const TIMERS = [0, 300, 3600, 10800, 43200]; // seconds per pick; 0 = no limit
export const VOTE_WINDOW = 86400; // voting closes 24 h after the last pick (the host can reveal earlier)

// Which drafter (index into order) makes overall pick n (0-based) with k drafters, snake style:
// round 1 goes 1..k, round 2 goes k..1, and so on.
export function snakeIndex(n, k) {
  const round = Math.floor(n / k);
  const i = n % k;
  return round % 2 === 0 ? i : k - 1 - i;
}
export const totalPicks = (k, rounds) => k * rounds;
export const roundOf = (n, k) => Math.floor(n / k);

// Normalise a pick for duplicate checks: case, accents, punctuation, a leading "the".
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')
    .replace(/\s+/g, ' ');
}

export function takenSet(picks) {
  return new Set(picks.filter((p) => p.item).map((p) => norm(p.item)));
}
export const isTaken = (item, picks) => takenSet(picks).has(norm(item));

// First pool item nobody has taken yet (pools are ordered most-picked first).
export function autoPick(pool, picks) {
  const taken = takenSet(picks);
  return (pool || []).find((x) => !taken.has(norm(x))) ?? null;
}

// Parse a pasted list (one per line or comma-separated) into unique, trimmed items.
export function parsePool(text, max = 200, maxLen = 60) {
  const raw = Array.isArray(text) ? text : String(text ?? '').split(/\n|,(?![^(]*\))/);
  const seen = new Set();
  const out = [];
  for (let s of raw) {
    s = String(s).replace(/^\s*(\d+[.)]|[-*•])\s*/, '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
    const k = norm(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

// Who is on the clock given the current picks. Returns null once the draft is complete.
export function onClock(order, rounds, pickCount) {
  const k = order.length;
  if (!k || pickCount >= totalPicks(k, rounds)) return null;
  return { n: pickCount, round: roundOf(pickCount, k), memberId: order[snakeIndex(pickCount, k)] };
}

// Timed picks expire lazily. Given the draft at time `now`, return the picks the clock has made
// (autopick from the pool, or a skipped slot when the pool is used up) and when the new pick started.
export function catchUp({ order, rounds, picks, timer, startedAt, pool, now }) {
  const made = [];
  if (!timer) return { made, startedAt };
  let at = startedAt;
  const all = picks.slice();
  while (now >= at + timer) {
    const c = onClock(order, rounds, all.length);
    if (!c) break;
    at += timer;
    const item = autoPick(pool, all);
    const p = { n: c.n, memberId: c.memberId, item, auto: item ? 1 : 2, at }; // auto: 1 = autopicked, 2 = skipped
    all.push(p);
    made.push(p);
  }
  return { made, startedAt: at };
}

// Team votes: each voter names one drafter's team. Returns counts and the winner ids (ties share).
export function tally(votes, drafterIds) {
  const counts = Object.fromEntries(drafterIds.map((id) => [id, 0]));
  for (const v of votes) if (v.team in counts) counts[v.team] += 1;
  const top = Math.max(0, ...Object.values(counts));
  const winners = top > 0 ? drafterIds.filter((id) => counts[id] === top) : [];
  return { counts, winners, total: votes.filter((v) => v.team in counts).length };
}

// "Pick of the draft": the single pick most voters singled out. Returns {n, votes} or null; ties go to the earlier pick.
export function pickOfDraft(votes) {
  const c = new Map();
  for (const v of votes) if (Number.isInteger(v.mvp)) c.set(v.mvp, (c.get(v.mvp) || 0) + 1);
  let best = null;
  for (const [n, k] of c) if (!best || k > best.votes || (k === best.votes && n < best.n)) best = { n, votes: k };
  return best;
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function timerLabel(sec) {
  if (!sec) return 'No time limit';
  if (sec < 3600) return `${sec / 60} min per pick`;
  return `${sec / 3600} h per pick`;
}
