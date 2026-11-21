// Serves the draft page with a link preview (Open Graph) showing live state, e.g.
// "Best Christmas movies · Round 4 of 6 · Kevin on the clock".
import { onClock, catchUp, totalPicks, tally, VOTE_WINDOW } from '../public/draft.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export async function describe(env, id) {
  const d = await env.DB.prepare('SELECT * FROM drafts WHERE id = ?1').bind(id).first();
  if (!d) return null;
  const members = (await env.DB.prepare('SELECT id, name, role FROM members WHERE draft_id = ?1').bind(id).all()).results;
  const name = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const drafters = members.filter((m) => m.role === 'drafter');
  const t = Math.floor(Date.now() / 1000);
  if (d.status === 'lobby') {
    return {
      title: `Draft: ${d.title}`,
      desc: `${plural(drafters.length, 'drafter', 'drafters')} so far · ${d.rounds} rounds. Join as a drafter or vote on the best team. No sign-up.`,
    };
  }
  const order = JSON.parse(d.draft_order);
  let picks = (await env.DB.prepare('SELECT n, member_id AS memberId, item FROM picks WHERE draft_id = ?1 ORDER BY n').bind(id).all()).results;
  let status = d.status;
  // Mirror the API's lazy clock so a preview never shows a stale "on the clock".
  if (status === 'drafting' && d.timer) {
    const { made } = catchUp({ order, rounds: d.rounds, picks, timer: d.timer, startedAt: d.pick_started_at, pool: JSON.parse(d.pool), now: t });
    picks = picks.concat(made);
    if (picks.length >= totalPicks(order.length, d.rounds)) status = 'voting';
  }
  const votes = (await env.DB.prepare('SELECT team FROM votes WHERE draft_id = ?1').bind(id).all()).results;
  const voteEnds = d.vote_ends_at || (picks.length ? t + VOTE_WINDOW : 0);
  if (status === 'voting' && voteEnds && t >= voteEnds) status = 'done';
  if (status === 'drafting') {
    const c = onClock(order, d.rounds, picks.length);
    const last = picks.filter((p) => p.item).at(-1);
    return {
      title: `${d.title} · Round ${c.round + 1} of ${d.rounds} · ${name[c.memberId] || 'Someone'} on the clock`,
      desc: `${last ? `Last pick: ${name[last.memberId] || '?'} took ${last.item}. ` : ''}${plural(order.length, 'drafter', 'drafters')}, snake order. Watch the board or join as a voter.`,
    };
  }
  if (status === 'voting') {
    return {
      title: `${d.title} · Vote for the best team`,
      desc: `The draft is done: ${order.map((m) => name[m]).join(', ')}. ${plural(votes.length, 'vote', 'votes')} so far. Results unlock when voting closes.`,
    };
  }
  const r = tally(votes, order);
  const win = r.winners.map((m) => name[m] || '?');
  const scores = order.map((m) => r.counts[m]).sort((a, b) => b - a);
  if (!win.length) return { title: `${d.title} · Draft finished`, desc: 'See every team’s picks, then draft your own topic.' };
  return {
    title: win.length > 1 ? `🏆 ${win.join(' & ')} tied “${d.title}”` : `🏆 ${win[0]}’s team won “${d.title}”`,
    desc: `${scores.slice(0, 2).join('–')} on ${plural(r.total, 'vote', 'votes')}. See every team’s picks, then draft your own topic.`,
  };
}

export async function draftPage(env, request, info) {
  const url = new URL(request.url);
  const page = await env.ASSETS.fetch(new URL('/d', url.origin));
  let html = await page.text();
  info = info || { title: 'Join this draft · Draftoff', desc: 'Take turns picking, then the group votes on the best team. No sign-up, no app.' };
  const canonical = `${url.origin}${url.pathname}`;
  const meta = `<title>${esc(info.title)}</title>
<meta name="description" content="${esc(info.desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Draftoff">
<meta property="og:title" content="${esc(info.title)}">
<meta property="og:description" content="${esc(info.desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${url.origin}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">`;
  html = html.replace(/<!--META-->[\s\S]*?<!--\/META-->/, meta);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
