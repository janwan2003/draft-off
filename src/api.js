// Draftoff API: create a draft, join as drafter or voter, snake-draft picks with a per-pick clock,
// then the group votes for the best team. Auth is a random per-person token (header x-token),
// stored only as a SHA-256 hash. Timed picks expire lazily on the next request after the deadline.
import {
  MIN_DRAFTERS, MAX_DRAFTERS, MIN_ROUNDS, MAX_ROUNDS, TIMERS, VOTE_WINDOW,
  norm, parsePool, onClock, catchUp, autoPick, tally, pickOfDraft, shuffle, totalPicks,
} from '../public/draft.js';
import { topicBySlug } from '../public/topics.js';

const MAX_MEMBERS = 120;
export const KEEP_DAYS = 180;
const LIMITS = { create: 20, join: 60, write: 900 }; // per IP hash per hour

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status, error) => json({ error }, status);
const now = () => Math.floor(Date.now() / 1000);

export function rid(len = 10) {
  const abc = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
function token() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

async function limited(env, request, bucket) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const key = `${bucket}:${(await sha('do:' + ip)).slice(0, 24)}`;
  return !(await env.LIMITER.get(env.LIMITER.idFromName(key)).hit(LIMITS[bucket], 3600_000));
}

async function whoAmI(env, request, id) {
  const t = request.headers.get('x-token');
  if (!t || t.length > 100) return null;
  return env.DB.prepare('SELECT id, name, role FROM members WHERE token_hash = ?1 AND draft_id = ?2').bind(await sha(t), id).first();
}

const loadDraft = (env, id) => env.DB.prepare('SELECT * FROM drafts WHERE id = ?1').bind(id).first();
const loadPicks = async (env, id) =>
  (await env.DB.prepare('SELECT n, member_id AS memberId, item, auto, created_at AS at FROM picks WHERE draft_id = ?1 ORDER BY n').bind(id).all()).results;

// SQL to store pick p and, if it was the last one, open voting.
function pickStatements(env, d, p, total, at) {
  const last = p.n + 1 >= total;
  return [
    env.DB.prepare('INSERT INTO picks (draft_id, n, member_id, item, norm, auto, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(d.id, p.n, p.memberId, p.item, p.item ? norm(p.item) : null, p.auto, p.at),
    env.DB.prepare('UPDATE drafts SET pick_started_at = ?1, status = ?2, vote_ends_at = ?3, version = version + 1 WHERE id = ?4')
      .bind(at, last ? 'voting' : 'drafting', last ? at + VOTE_WINDOW : null, d.id),
  ];
}

// Apply expired pick clocks and an expired voting window. Returns the fresh draft row.
async function advance(env, d) {
  const t = now();
  if (d.status === 'drafting' && d.timer > 0 && t >= d.pick_started_at + d.timer) {
    const order = JSON.parse(d.draft_order);
    const picks = await loadPicks(env, d.id);
    const { made } = catchUp({ order, rounds: d.rounds, picks, timer: d.timer, startedAt: d.pick_started_at, pool: JSON.parse(d.pool), now: t });
    if (made.length) {
      const total = totalPicks(order.length, d.rounds);
      const stmts = made.flatMap((p) => pickStatements(env, d, p, total, p.at));
      try { await env.DB.batch(stmts); } catch { /* another request already applied it: reload */ }
      d = await loadDraft(env, d.id);
    }
  }
  if (d && d.status === 'voting' && d.vote_ends_at && t >= d.vote_ends_at) {
    await env.DB.prepare("UPDATE drafts SET status = 'done', version = version + 1 WHERE id = ?1 AND status = 'voting'").bind(d.id).run();
    d = await loadDraft(env, d.id);
  }
  return d;
}

async function state(env, d, mine) {
  const [members, picksRes, votesRes] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, role FROM members WHERE draft_id = ?1 ORDER BY created_at, rowid').bind(d.id),
    env.DB.prepare('SELECT n, member_id AS memberId, item, auto, created_at AS at FROM picks WHERE draft_id = ?1 ORDER BY n').bind(d.id),
    env.DB.prepare('SELECT member_id AS memberId, team, mvp FROM votes WHERE draft_id = ?1').bind(d.id),
  ]);
  const order = JSON.parse(d.draft_order);
  const picks = picksRes.results;
  const votes = votesRes.results;
  const drafters = members.results.filter((m) => m.role === 'drafter').map((m) => m.id);
  const clock = d.status === 'drafting' ? onClock(order, d.rounds, picks.length) : null;
  const isHost = !!mine && mine.id === d.host_id;
  const myVote = mine ? votes.find((v) => v.memberId === mine.id) || null : null;
  const out = {
    id: d.id,
    title: d.title,
    topic: d.topic,
    pool: JSON.parse(d.pool),
    rounds: d.rounds,
    timer: d.timer,
    status: d.status,
    order,
    members: members.results.map((m) => ({ ...m, host: m.id === d.host_id })),
    picks,
    clock: clock ? { ...clock, startedAt: d.pick_started_at, endsAt: d.timer ? d.pick_started_at + d.timer : null } : null,
    voteEndsAt: d.vote_ends_at,
    voters: votes.map((v) => v.memberId),
    me: mine ? { id: mine.id, name: mine.name, role: mine.role, host: isHost } : null,
    myVote: myVote ? { team: myVote.team, mvp: myVote.mvp } : null,
    now: now(),
    version: d.version,
    createdAt: d.created_at,
  };
  if (d.status === 'done') {
    out.result = { ...tally(votes, order.length ? order : drafters), pickOfDraft: pickOfDraft(votes) };
  }
  return out;
}

async function join(env, d, body) {
  const name = clean(body.name, 24);
  if (!name) return fail(400, 'Type a name so friends know who you are.');
  const role = body.role === 'drafter' ? 'drafter' : 'voter';
  if (d.status === 'done') return fail(409, 'This draft is finished. Start your own.');
  const counts = await env.DB.prepare("SELECT COUNT(*) AS c, SUM(role = 'drafter') AS dr FROM members WHERE draft_id = ?1").bind(d.id).first();
  if (counts.c >= MAX_MEMBERS) return fail(409, 'This draft is full.');
  if (role === 'drafter') {
    if (d.status !== 'lobby') return fail(409, 'The draft has started, so you can join as a voter.');
    if ((counts.dr || 0) >= MAX_DRAFTERS) return fail(409, `All ${MAX_DRAFTERS} drafter spots are taken. Join as a voter.`);
  }
  const taken = await env.DB.prepare('SELECT 1 FROM members WHERE draft_id = ?1 AND lower(name) = lower(?2)').bind(d.id, name).first();
  if (taken) return fail(409, `Someone called “${name}” is already in. Add an initial?`);
  const id = rid(12);
  const tok = token();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO members (id, draft_id, name, role, token_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(id, d.id, name, role, await sha(tok), now()),
    env.DB.prepare('UPDATE drafts SET version = version + 1 WHERE id = ?1').bind(d.id),
  ]);
  return json({ token: tok, memberId: id, name, role }, 201);
}

function settingsFrom(body, env) {
  const rounds = Number(body.rounds);
  const timer = Number(body.timer);
  if (!Number.isInteger(rounds) || rounds < MIN_ROUNDS || rounds > MAX_ROUNDS) return { error: `Rounds must be ${MIN_ROUNDS}–${MAX_ROUNDS}.` };
  // TEST_TIMER (wrangler dev --var TEST_TIMER:4) allows a few-second clock for the e2e test only.
  if (!TIMERS.includes(timer) && !(env.TEST_TIMER && timer === Number(env.TEST_TIMER))) return { error: 'Pick a time limit from the list.' };
  return { rounds, timer };
}

async function create(env, body, id) {
  const title = clean(body.title, 80);
  if (!title) return fail(400, 'Name the topic, like “Best Christmas movies”.');
  const name = clean(body.name, 24);
  if (!name) return fail(400, 'Type your name so friends know who started it.');
  const s = settingsFrom(body, env);
  if (s.error) return fail(400, s.error);
  const topic = topicBySlug(String(body.topic || ''));
  // A topic pack brings its suggestion pool (the title may be reworded); a custom topic may paste its own.
  const pool = topic ? topic.pool.slice() : parsePool(body.pool ?? '', 200, 60);
  const hostId = rid(12);
  const tok = token();
  const t = now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO drafts (id, title, topic, pool, rounds, timer, status, host_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)')
      .bind(id, title, topic ? topic.slug : null, JSON.stringify(pool), s.rounds, s.timer, 'lobby', hostId, t),
    env.DB.prepare('INSERT INTO members (id, draft_id, name, role, token_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(hostId, id, name, 'drafter', await sha(tok), t),
  ]);
  return json({ id, token: tok, memberId: hostId, name, role: 'drafter' }, 201);
}

const removeDraft = (env) => env.wipe();

async function act(env, d, mine, action, body) {
  const isHost = mine.id === d.host_id;
  const t = now();
  const bump = () => env.DB.prepare('UPDATE drafts SET version = version + 1 WHERE id = ?1').bind(d.id);

  if (action === 'settings') {
    if (!isHost) return fail(403, 'Only the person who started the draft can change it.');
    if (d.status !== 'lobby') return fail(409, 'The draft has already started.');
    const s = settingsFrom(body, env);
    if (s.error) return fail(400, s.error);
    await env.DB.prepare('UPDATE drafts SET rounds = ?1, timer = ?2, version = version + 1 WHERE id = ?3').bind(s.rounds, s.timer, d.id).run();
    return json({ ok: true });
  }

  if (action === 'start') {
    if (!isHost) return fail(403, 'Only the person who started the draft can start it.');
    if (d.status !== 'lobby') return fail(409, 'The draft has already started.');
    const ids = (await env.DB.prepare("SELECT id FROM members WHERE draft_id = ?1 AND role = 'drafter' ORDER BY created_at, rowid").bind(d.id).all()).results.map((r) => r.id);
    if (ids.length < MIN_DRAFTERS) return fail(409, `You need at least ${MIN_DRAFTERS} drafters. Share the link first.`);
    const order = body.shuffle === false ? ids : shuffle(ids);
    const r = await env.DB.prepare("UPDATE drafts SET status = 'drafting', draft_order = ?1, pick_started_at = ?2, version = version + 1 WHERE id = ?3 AND status = 'lobby'")
      .bind(JSON.stringify(order), t, d.id).run();
    if (!r.meta.changes) return fail(409, 'The draft has already started.');
    return json({ ok: true });
  }

  if (action === 'pick' || action === 'autopick') {
    if (d.status !== 'drafting') return fail(409, d.status === 'lobby' ? 'The draft has not started yet.' : 'The draft is over.');
    const order = JSON.parse(d.draft_order);
    const picks = await loadPicks(env, d.id);
    const c = onClock(order, d.rounds, picks.length);
    if (!c) return fail(409, 'The draft is over.');
    let item, auto = 0;
    if (action === 'pick') {
      if (c.memberId !== mine.id) return fail(409, 'It is not your turn yet.');
      if (Number.isInteger(body.n) && body.n !== c.n) return fail(409, 'The board changed. Check the latest picks.');
      item = clean(body.item, 60);
      if (!item) return fail(400, 'Type your pick.');
      if (picks.some((p) => p.item && norm(p.item) === norm(item))) return fail(409, `“${item}” is already taken. Pick something else.`);
      // Store a loosely typed pick under the suggestion's own spelling ("the home alone" → "Home Alone").
      item = JSON.parse(d.pool).find((x) => norm(x) === norm(item)) || item;
    } else {
      if (!isHost && c.memberId !== mine.id) return fail(403, 'Only the host can pick for someone else.');
      item = autoPick(JSON.parse(d.pool), picks);
      auto = item ? 1 : 2;
    }
    try {
      await env.DB.batch(pickStatements(env, d, { n: c.n, memberId: c.memberId, item, auto, at: t }, totalPicks(order.length, d.rounds), t));
    } catch {
      return fail(409, 'Someone just picked that. Check the latest board.');
    }
    return json({ ok: true, item });
  }

  if (action === 'undo') {
    if (!['drafting', 'voting'].includes(d.status)) return fail(409, 'Nothing to undo.');
    const last = await env.DB.prepare('SELECT n, member_id FROM picks WHERE draft_id = ?1 ORDER BY n DESC LIMIT 1').bind(d.id).first();
    if (!last) return fail(409, 'No picks yet.');
    if (!isHost && last.member_id !== mine.id) return fail(403, 'You can only take back your own pick, before the next one.');
    const v = await env.DB.prepare('SELECT COUNT(*) AS c FROM votes WHERE draft_id = ?1').bind(d.id).first();
    if (v.c > 0) return fail(409, 'Voting has started, so picks are locked.');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM picks WHERE draft_id = ?1 AND n = ?2').bind(d.id, last.n),
      env.DB.prepare("UPDATE drafts SET status = 'drafting', vote_ends_at = NULL, pick_started_at = ?1, version = version + 1 WHERE id = ?2").bind(t, d.id),
    ]);
    return json({ ok: true });
  }

  if (action === 'vote') {
    if (d.status !== 'voting') return fail(409, d.status === 'done' ? 'Voting has closed.' : 'Voting opens after the last pick.');
    const order = JSON.parse(d.draft_order);
    const team = String(body.team || '');
    if (!order.includes(team)) return fail(400, 'Choose a team.');
    if (team === mine.id) return fail(400, 'Nice try. Vote for someone else’s team.');
    let mvp = body.mvp;
    if (mvp != null) {
      const p = await env.DB.prepare('SELECT member_id, item FROM picks WHERE draft_id = ?1 AND n = ?2').bind(d.id, Number(mvp)).first();
      if (!p || !p.item || p.member_id === mine.id) mvp = null;
      else mvp = Number(mvp);
    }
    await env.DB.batch([
      env.DB.prepare('INSERT INTO votes (draft_id, member_id, team, mvp, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(draft_id, member_id) DO UPDATE SET team = ?3, mvp = ?4, created_at = ?5')
        .bind(d.id, mine.id, team, mvp ?? null, t),
      bump(),
    ]);
    return json({ ok: true });
  }

  if (action === 'reveal') {
    if (d.status !== 'voting') return fail(409, 'Voting is not open.');
    if (!isHost) return fail(403, 'Only the host can reveal early. Results unlock when voting closes.');
    const v = await env.DB.prepare('SELECT COUNT(*) AS c FROM votes WHERE draft_id = ?1').bind(d.id).first();
    if (!v.c) return fail(409, 'Nobody has voted yet.');
    await env.DB.prepare("UPDATE drafts SET status = 'done', vote_ends_at = ?1, version = version + 1 WHERE id = ?2 AND status = 'voting'").bind(t, d.id).run();
    return json({ ok: true });
  }

  if (action === 'remove') {
    // Leave (yourself) or, for the host, remove someone. Drafters can only leave before the draft starts.
    const target = body.memberId ? String(body.memberId) : mine.id;
    if (target !== mine.id && !isHost) return fail(403, 'Only the host can remove people.');
    if (target === d.host_id) return fail(409, 'The host cannot leave. Delete the draft instead.');
    const m = await env.DB.prepare('SELECT role FROM members WHERE id = ?1 AND draft_id = ?2').bind(target, d.id).first();
    if (!m) return fail(404, 'Not found.');
    if (m.role === 'drafter' && d.status !== 'lobby') return fail(409, 'Drafters stay once the draft has started.');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM votes WHERE draft_id = ?1 AND member_id = ?2').bind(d.id, target),
      env.DB.prepare('DELETE FROM members WHERE id = ?1').bind(target),
      bump(),
    ]);
    return json({ ok: true });
  }

  return fail(404, 'Unknown action.');
}

export async function handle(request, env) {
  try {
    const parts = new URL(request.url).pathname.split('/').slice(2).filter(Boolean);
    const method = request.method;
    if (method !== 'GET') {
      const origin = request.headers.get('origin');
      if (origin && new URL(origin).host !== new URL(request.url).host) return fail(403, 'Cross-site request blocked.');
    }
    let body = {};
    if (method === 'POST') {
      const text = await request.text();
      if (text.length > 20000) return fail(413, 'Too much text.');
      try { body = text ? JSON.parse(text) : {}; } catch { return fail(400, 'Bad JSON.'); }
    }
    if (parts[0] !== 'd') return fail(404, 'Not found.');

    if (parts.length === 1 && method === 'POST') {
      if (await limited(env, request, 'create')) return fail(429, 'You have started a lot of drafts. Try again in an hour.');
      return create(env, body, env.newId);
    }
    const id = String(parts[1] || '');
    if (!/^[A-Za-z0-9]{6,16}$/.test(id)) return fail(404, 'Draft not found.');
    let d = await loadDraft(env, id);
    if (!d) return fail(404, 'This draft does not exist or was deleted.');
    d = await advance(env, d);
    const mine = await whoAmI(env, request, id);

    if (parts.length === 2 && method === 'GET') {
      const since = Number(new URL(request.url).searchParams.get('v'));
      if (since && since === d.version && mine) return json({ same: true, version: d.version, now: now() });
      return json(await state(env, d, mine));
    }
    if (parts.length === 2 && method === 'DELETE') {
      if (!mine || mine.id !== d.host_id) return fail(403, 'Only the host can delete this draft.');
      await removeDraft(env);
      return json({ ok: true });
    }
    if (parts.length === 3 && method === 'POST') {
      const action = parts[2];
      if (action === 'join') {
        if (await limited(env, request, 'join')) return fail(429, 'Too many joins from here. Try again later.');
        return join(env, d, body);
      }
      if (!mine) return fail(401, 'Join the draft first.');
      if (await limited(env, request, 'write')) return fail(429, 'Slow down a little and try again.');
      return act(env, d, mine, action, body);
    }
    return fail(405, 'Method not allowed.');
  } catch (e) {
    console.error(e);
    return fail(500, 'Something went wrong on our side. Try again.');
  }
}
