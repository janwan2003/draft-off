// Draft page: lobby, live snake-draft board with a pick box, voting, results.
import { api, saveMine, loadMine, tokenFor, h, toast, copy, shareLink, left } from './common.js';
import { norm, snakeIndex, timerLabel, MIN_DRAFTERS, MAX_DRAFTERS, TIMERS } from './draft.js';
import { renderCard } from './card.js';

const app = document.getElementById('app');
const id = location.pathname.split('/')[2] || '';
let s = null; // last state from the API
let skew = 0; // server time - local time, seconds
let ui = { role: 'drafter', team: null, mvp: null, pick: '', sel: -1, shuffle: true };
let busy = false;

// A private link carries the token in the hash (#k=...): store it and clean the URL.
const hm = location.hash.match(/k=([A-Za-z0-9_-]{20,100})/);
if (hm) {
  saveMine(id, { token: hm[1] });
  history.replaceState(null, '', location.pathname);
}

const nowS = () => Math.floor(Date.now() / 1000) + skew;
const nameOf = (mid) => (s.members.find((m) => m.id === mid) || {}).name || 'Someone';
const link = () => `${location.origin}/d/${id}`;
const drafters = () => (s.order.length ? s.order.map((mid) => s.members.find((m) => m.id === mid) || { id: mid, name: '?' }) : s.members.filter((m) => m.role === 'drafter'));

async function load(full = false) {
  const tok = tokenFor(id);
  try {
    const r = await api(`/d/${id}${!full && s && s.me ? `?v=${s.version}` : ''}`, { token: tok });
    skew = r.now - Math.floor(Date.now() / 1000);
    if (r.same) return;
    const before = s;
    s = r;
    if (s.me) saveMine(id, { title: s.title, name: s.me.name, memberId: s.me.id, host: s.me.host });
    else if (tok) saveMine(id, { token: null });
    notifyTurn(before);
    render();
  } catch (e) {
    if (e.status === 404) {
      saveMine(id, null);
      app.replaceChildren(h('div', { class: 'card center', style: 'padding:40px 20px' }, h('h1', { style: 'font-size:1.7rem' }, 'Draft not found'),
        h('p', { class: 'muted' }, 'It was deleted or the link is incomplete.'), h('a', { class: 'btn hot', href: '/' }, 'Start a draft')));
      s = null;
      return;
    }
    if (!s) app.replaceChildren(h('div', { class: 'card center' }, h('p', {}, e.message), h('button', { class: 'btn', onclick: () => load(true) }, 'Try again')));
  }
}

function notifyTurn(before) {
  if (!before || !s.me || !s.clock) return;
  const wasMine = before.clock && before.clock.memberId === s.me.id;
  if (!wasMine && s.clock.memberId === s.me.id) {
    toast('You’re on the clock!');
    document.title = '● Your pick · ' + s.title;
  }
}

async function act(action, body = {}, okMsg) {
  if (busy) return false;
  busy = true;
  try {
    await api(`/d/${id}/${action}`, { method: 'POST', body, token: tokenFor(id) });
    if (okMsg) toast(okMsg);
    await load(true);
    return true;
  } catch (e) {
    toast(e.message);
    await load(true);
    return false;
  } finally {
    busy = false;
  }
}

function statusPill() {
  if (s.status === 'lobby') return h('span', { class: 'pill' }, `Lobby · ${drafters().length} of ${MAX_DRAFTERS} drafters`);
  if (s.status === 'drafting') return h('span', { class: 'pill hot' }, `Round ${s.clock.round + 1} of ${s.rounds} · ${nameOf(s.clock.memberId)} on the clock`);
  if (s.status === 'voting') return h('span', { class: 'pill hot' }, `Voting · ${s.voters.length} ${s.voters.length === 1 ? 'vote' : 'votes'} so far`);
  return h('span', { class: 'pill done' }, 'Final result');
}

function inviteText() {
  if (s.status === 'lobby') return `Draft time: “${s.title}”. Join as a drafter or vote on the best team:`;
  if (s.status === 'drafting') return `“${s.title}” draft · round ${s.clock.round + 1} of ${s.rounds}. ${nameOf(s.clock.memberId)}, you’re on the clock:`;
  if (s.status === 'voting') return `The “${s.title}” draft is done. Vote for the best team:`;
  return `Results are in for “${s.title}”:`;
}
async function invite(text = inviteText()) {
  const r = await shareLink({ title: s.title, text, url: link() });
  if (r === 'copied') toast('Link copied. Paste it in the group chat.');
  else if (r === 'failed') toast(link());
}

function header() {
  return h('div', { class: 'dhead' },
    h('div', {}, h('h1', {}, s.title), h('div', { class: 'row' }, statusPill(),
      h('span', { class: 'muted small' }, `${s.rounds} picks each · ${timerLabel(s.timer)}`))),
    s.status !== 'done' ? h('button', { class: 'btn small', id: 'invite', onclick: () => invite() }, 'Invite') : null);
}

// ---------- Board ----------
function board() {
  const ds = drafters();
  const k = Math.max(ds.length, 1);
  const byN = new Map(s.picks.map((p) => [p.n, p]));
  const win = s.result ? new Set(s.result.winners) : new Set();
  const mvp = s.result && s.result.pickOfDraft ? s.result.pickOfDraft.n : -1;
  const g = h('div', { class: 'board', id: 'board', style: `grid-template-columns:28px repeat(${k}, minmax(100px, 1fr))` });
  g.append(h('div', { class: 'cell rd' }, ''));
  for (const d of ds) g.append(h('div', { class: `cell hd${s.me && d.id === s.me.id ? ' me' : ''}${win.has(d.id) ? ' win' : ''}`, title: d.name }, (win.has(d.id) ? '🏆 ' : '') + d.name));
  for (let r = 0; r < s.rounds; r++) {
    g.append(h('div', { class: 'cell rd' }, `R${r + 1}`));
    for (let c = 0; c < k; c++) {
      if (!s.order.length) { g.append(h('div', { class: 'cell empty' }, '')); continue; }
      // Column c in round r is pick n where snakeIndex(n) === c.
      const i = r % 2 === 0 ? c : k - 1 - c;
      const n = r * k + i;
      const p = byN.get(n);
      if (p) {
        const cls = ['cell'];
        if (p.auto === 1) cls.push('auto');
        if (p.auto === 2) cls.push('skip');
        if (win.has(ds[c].id)) cls.push('win');
        if (n === mvp) cls.push('mvp');
        g.append(h('div', { class: cls.join(' '), 'data-n': n }, h('span', { class: 'num' }, `#${n + 1}${n === mvp ? ' · ⭐ pick of the draft' : ''}`), p.item || 'skipped'));
      } else if (s.clock && s.clock.n === n) {
        g.append(h('div', { class: 'cell now' }, h('span', { class: 'num' }, `#${n + 1}`), 'on the clock…'));
      } else {
        g.append(h('div', { class: 'cell empty' }, h('span', { class: 'num' }, `#${n + 1}`)));
      }
    }
  }
  return h('div', { class: 'card' }, h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:10px' }, h('h2', { style: 'margin:0' }, 'Draft board'),
    s.order.length ? h('span', { class: 'muted small' }, 'Snake order: the last pick of a round picks first in the next') : h('span', { class: 'muted small' }, 'Order is set when the draft starts')),
  h('div', { class: 'boardwrap' }, g));
}

// ---------- Join ----------
function joinCard() {
  const lobby = s.status === 'lobby';
  const spots = MAX_DRAFTERS - drafters().length;
  if (!lobby) ui.role = 'voter';
  const name = h('input', { type: 'text', id: 'joinname', maxlength: 24, placeholder: 'Your name', autocomplete: 'nickname' });
  try { name.value = localStorage.getItem('draftoff:name') || ''; } catch { /* ignore */ }
  const err = h('p', { class: 'err', role: 'alert' });
  const roleBtn = (role, title, sub) => h('button', { type: 'button', class: 'role', 'aria-pressed': String(ui.role === role), disabled: role === 'drafter' && spots <= 0,
    onclick: () => { ui.role = role; render(); } }, h('b', {}, title), h('span', {}, sub));
  const go = async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      const r = await api(`/d/${id}/join`, { method: 'POST', body: { name: name.value, role: ui.role } });
      saveMine(id, { token: r.token, memberId: r.memberId, name: r.name, title: s.title });
      try { localStorage.setItem('draftoff:name', r.name); } catch { /* ignore */ }
      toast(r.role === 'drafter' ? 'You’re in the draft!' : 'You’re in. You can vote once the draft is done.');
      await load(true);
    } catch (ex) { err.textContent = ex.message; }
  };
  return h('form', { class: 'card lobbyjoin', id: 'join', onsubmit: go },
    h('h2', {}, lobby ? `${nameOf(s.members.find((m) => m.host)?.id)} invited you to a draft` : 'Join to vote'),
    h('p', { class: 'muted', style: 'margin:0' }, lobby ? 'Draft a team, or just vote on whose team is best.' : 'Watch the picks come in, then vote for the best team when the draft ends.'),
    lobby ? h('div', { class: 'roles' }, roleBtn('drafter', 'Draft', spots > 0 ? `${spots} ${spots === 1 ? 'spot' : 'spots'} left` : 'Full'), roleBtn('voter', 'Just vote', 'Judge the teams')) : null,
    h('label', { for: 'joinname' }, 'Your name'), name, err,
    h('button', { class: 'btn hot wide', type: 'submit', id: 'joinbtn' }, ui.role === 'drafter' && lobby ? 'Join the draft' : 'Join as a voter'));
}

// ---------- Lobby ----------
function lobbyCard() {
  const ds = drafters();
  const host = s.me && s.me.host;
  const kids = [h('h2', {}, host ? 'Get your drafters in' : 'Waiting for the draft to start')];
  if (host) {
    const rounds = h('select', { id: 'set-rounds' }, [3, 4, 5, 6, 7, 8].map((n) => h('option', { value: n, selected: n === s.rounds }, n)));
    const timer = h('select', { id: 'set-timer' }, TIMERS.map((t) => h('option', { value: t, selected: t === s.timer }, t ? timerLabel(t).replace(' per pick', '') : 'No limit')));
    const save = () => act('settings', { rounds: Number(rounds.value), timer: Number(timer.value) }, 'Saved');
    rounds.onchange = save; timer.onchange = save;
    const shuffle = h('input', { type: 'checkbox', id: 'shuffle', checked: ui.shuffle, style: 'width:auto;min-height:0;margin-right:8px', onchange: (e) => { ui.shuffle = e.target.checked; } });
    kids.push(
      h('p', { class: 'muted' }, ds.length < MIN_DRAFTERS ? 'Send the link to the group chat. You need at least one more drafter. Everyone else can join as a voter.' : `${ds.length} drafters are in. Start when everyone who wants to draft has joined.`),
      h('div', { class: 'row', style: 'margin-bottom:12px' }, h('button', { class: 'btn hot', onclick: () => invite() }, 'Share the link'), h('button', { class: 'btn ghost', onclick: async () => toast((await copy(link())) ? 'Link copied' : link()) }, 'Copy link')),
      h('div', { class: 'grid2' }, h('div', {}, h('label', { for: 'set-rounds' }, 'Picks each'), rounds), h('div', {}, h('label', { for: 'set-timer' }, 'Time per pick'), timer)),
      h('label', { style: 'display:flex;align-items:center;font-weight:600;margin:14px 0' }, shuffle, 'Random draft order'),
      h('button', { class: 'btn wide', id: 'start', disabled: ds.length < MIN_DRAFTERS, onclick: () => act('start', { shuffle: shuffle.checked }, 'The draft is on!') }, `Start the draft (${ds.length} drafters)`));
  } else {
    kids.push(h('p', { class: 'muted' }, `${nameOf(s.members.find((m) => m.host)?.id)} starts the draft once the drafters are in. ${s.me && s.me.role === 'drafter' ? 'You’ll pick in turn; keep this page or the link handy.' : 'You’ll vote when the draft is done.'}`),
      h('button', { class: 'btn ghost', onclick: () => invite() }, 'Invite more people'));
  }
  return h('div', { class: 'card' }, kids);
}

// ---------- Drafting ----------
function suggestions(q) {
  const taken = new Set(s.picks.filter((p) => p.item).map((p) => norm(p.item)));
  const nq = norm(q);
  const list = s.pool.filter((x) => !nq || norm(x).includes(nq));
  list.sort((a, b) => (norm(a).startsWith(nq) ? 0 : 1) - (norm(b).startsWith(nq) ? 0 : 1));
  return list.slice(0, 8).map((x) => ({ x, taken: taken.has(norm(x)) }));
}

function clockCard() {
  const c = s.clock;
  const mine = s.me && c.memberId === s.me.id;
  const host = s.me && s.me.host;
  const kids = [];
  const timeLeft = c.endsAt ? h('span', { class: 'countdown', 'data-ends': c.endsAt }, left(c.endsAt - nowS())) : null;
  if (mine) {
    kids.push(h('div', { class: 'who' }, `Your pick! Round ${c.round + 1}, pick #${c.n + 1}`));
    if (timeLeft) kids.push(h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Time left: ', timeLeft, s.pool.length ? '. Then the next suggestion is picked for you.' : '. Then your turn is skipped.'));
    const input = h('input', { type: 'text', id: 'pick', maxlength: 60, placeholder: s.pool.length ? 'Type to search or enter anything' : 'Type your pick', autocomplete: 'off', value: ui.pick, 'aria-autocomplete': 'list' });
    const list = h('ul', { class: 'sugg hidden', role: 'listbox', id: 'sugg' });
    const err = h('p', { class: 'err', role: 'alert' });
    const fill = () => {
      const items = s.pool.length ? suggestions(input.value) : [];
      list.replaceChildren(...items.map((it, i) => h('li', { role: 'option', class: it.taken ? 'taken' : '', 'aria-selected': String(i === ui.sel),
        onmousedown: (e) => { e.preventDefault(); if (!it.taken) { input.value = it.x; ui.pick = it.x; list.classList.add('hidden'); check(); } } }, it.x, it.taken ? ' · taken' : '')));
      const exact = items.length === 1 && norm(items[0].x) === norm(input.value);
      list.classList.toggle('hidden', !items.length || exact || document.activeElement !== input);
    };
    const check = () => {
      const t = input.value.trim();
      err.textContent = t && s.picks.some((p) => p.item && norm(p.item) === norm(t)) ? `“${t}” is already taken.` : '';
    };
    input.addEventListener('input', () => { ui.pick = input.value; ui.sel = -1; fill(); check(); });
    input.addEventListener('focus', fill);
    input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 120));
    input.addEventListener('keydown', (e) => {
      const opts = [...list.children];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        ui.sel = Math.max(-1, Math.min(opts.length - 1, ui.sel + (e.key === 'ArrowDown' ? 1 : -1)));
        opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === ui.sel)));
      } else if (e.key === 'Enter' && ui.sel >= 0 && opts[ui.sel] && !list.classList.contains('hidden')) {
        e.preventDefault();
        opts[ui.sel].dispatchEvent(new MouseEvent('mousedown'));
        ui.sel = -1;
      }
    });
    const submit = async (e) => {
      e.preventDefault();
      const item = input.value.trim();
      if (!item) { err.textContent = 'Type your pick.'; return; }
      const next = nextAfterMine();
      ui.pick = '';
      const ok = await act('pick', { item, n: c.n }, `You picked ${item}`);
      if (!ok) { ui.pick = item; const el = document.getElementById('pick'); if (el) el.value = item; }
      else if (next) setTimeout(() => offerNudge(next, item), 300);
    };
    kids.push(h('form', { class: 'pickbox', onsubmit: submit, autocomplete: 'off' }, input, list, err,
      h('button', { class: 'btn hot wide', type: 'submit', id: 'pickbtn', style: 'margin-top:8px' }, 'Lock in pick')));
  } else {
    kids.push(h('div', { class: 'who' }, `${nameOf(c.memberId)} is on the clock`),
      h('p', { class: 'muted small', style: 'margin:2px 0 8px' }, `Round ${c.round + 1}, pick #${c.n + 1}`, timeLeft ? ' · ' : '', timeLeft || '', timeLeft ? ' left' : ''));
    const upNext = s.me && s.me.role === 'drafter' ? picksUntilMe() : null;
    if (upNext) kids.push(h('p', { class: 'small', style: 'margin:0 0 8px' }, upNext === 1 ? 'You’re up next.' : `You pick in ${upNext} turns.`));
    const row = h('div', { class: 'row' }, h('button', { class: 'btn small ghost', onclick: () => invite(`${nameOf(c.memberId)}, you’re on the clock in our “${s.title}” draft:`) }, `Nudge ${nameOf(c.memberId)}`));
    if (host) row.append(h('button', { class: 'btn small ghost', id: 'pickfor', onclick: () => confirm(`Pick for ${nameOf(c.memberId)} now? ${s.pool.length ? 'The next suggestion on the list is used.' : 'Their turn is skipped.'}`) && act('autopick', {}, 'Picked') }, `Pick for ${nameOf(c.memberId)}`));
    kids.push(row);
  }
  const last = s.picks.at(-1);
  if (last && s.me && (s.me.host || last.memberId === s.me.id)) {
    kids.push(h('button', { class: 'btn small danger', id: 'undo', style: 'margin-top:10px', onclick: () => confirm(`Undo pick #${last.n + 1} (${last.item || 'skipped'})?`) && act('undo', {}, 'Pick undone') },
      last.memberId === s.me.id ? 'Take back my last pick' : 'Undo last pick'));
  }
  return h('div', { class: `card clock${mine ? ' mine' : ''}`, id: 'clock' }, kids);
}

function picksUntilMe() {
  const k = s.order.length;
  for (let n = s.clock.n + 1, i = 1; n < k * s.rounds; n++, i++) if (s.order[snakeIndex(n, k)] === s.me.id) return i;
  return null;
}
function nextAfterMine() {
  const k = s.order.length;
  const n = s.clock.n + 1;
  if (n >= k * s.rounds) return null;
  const nx = s.order[snakeIndex(n, k)];
  return nx === s.me.id ? null : nx;
}
function offerNudge(next, item) {
  const box = document.getElementById('nudge');
  if (!box) return;
  box.replaceChildren(h('div', { class: 'notice' }, h('b', {}, `Tell ${nameOf(next)} they’re up`), h('p', { class: 'small', style: 'margin:4px 0 8px' }, 'A quick message in the group chat keeps the draft moving.'),
    h('button', { class: 'btn small hot', id: 'nudgebtn', onclick: () => invite(`I took ${item}. ${nameOf(next)}, you’re on the clock in our “${s.title}” draft:`) }, `Message ${nameOf(next)}`)));
}

function feed() {
  const items = s.picks.slice().reverse().slice(0, 30);
  if (!items.length) return null;
  return h('div', { class: 'card' }, h('h3', {}, 'Latest picks'), h('ul', { class: 'feed' }, items.map((p) =>
    h('li', {}, h('b', {}, nameOf(p.memberId)), p.auto === 2 ? ' ran out of time (skipped)' : p.auto === 1 ? ' got ' : ' took ', p.item ? h('b', {}, p.item) : '', p.auto === 1 ? ' (autopick)' : '', h('span', { class: 'muted small' }, ` · #${p.n + 1}`)))));
}

// ---------- Voting ----------
function teamOf(mid) { return s.picks.filter((p) => p.memberId === mid); }

function voteCard() {
  const me = s.me;
  const end = s.voteEndsAt ? h('span', { class: 'countdown', 'data-ends': s.voteEndsAt }, left(s.voteEndsAt - nowS())) : null;
  if (s.myVote && ui.team === null) { ui.team = s.myVote.team; ui.mvp = s.myVote.mvp; }
  const kids = [h('h2', {}, s.myVote ? 'Your vote is in' : 'Vote for the best team'),
    h('p', { class: 'muted small' }, `${s.voters.length} ${s.voters.length === 1 ? 'vote' : 'votes'} so far. Results unlock in `, end || '…', ' or when the host reveals them. ', me ? '' : 'Join with your name to vote.')];
  const teams = h('div', { class: 'teams' }, drafters().map((d) => {
    const own = me && d.id === me.id;
    return h('button', { type: 'button', class: 'team', 'aria-pressed': String(ui.team === d.id), disabled: own, 'data-team': d.name, onclick: () => { ui.team = d.id; render(); } },
      h('div', { class: 'tn' }, h('span', {}, `${d.name}’s team`), h('span', { class: 'muted small' }, own ? 'yours' : ui.team === d.id ? '✓ your vote' : '')),
      h('ol', {}, teamOf(d.id).map((p) => h('li', {}, p.item || h('span', { class: 'muted' }, 'skipped')))));
  }));
  kids.push(teams);
  const options = s.picks.filter((p) => p.item && (!me || p.memberId !== me.id));
  const mvp = h('select', { id: 'mvp', onchange: (e) => { ui.mvp = e.target.value === '' ? null : Number(e.target.value); } },
    h('option', { value: '' }, 'Skip'), options.map((p) => h('option', { value: p.n, selected: ui.mvp === p.n }, `${p.item} (${nameOf(p.memberId)}, #${p.n + 1})`)));
  kids.push(h('label', { for: 'mvp' }, 'Pick of the draft (optional)'), mvp);
  if (!me) {
    const name = h('input', { type: 'text', id: 'votename', maxlength: 24, placeholder: 'Your name', autocomplete: 'nickname' });
    try { name.value = localStorage.getItem('draftoff:name') || ''; } catch { /* ignore */ }
    kids.push(h('label', { for: 'votename' }, 'Your name'), name);
  }
  const err = h('p', { class: 'err', role: 'alert' });
  kids.push(err, h('button', { class: 'btn hot wide', id: 'votebtn', onclick: async () => {
    err.textContent = '';
    if (!ui.team) { err.textContent = 'Tap the team you think is best.'; return; }
    if (!s.me) {
      const nm = document.getElementById('votename').value;
      try {
        const r = await api(`/d/${id}/join`, { method: 'POST', body: { name: nm, role: 'voter' } });
        saveMine(id, { token: r.token, memberId: r.memberId, name: r.name, title: s.title });
        try { localStorage.setItem('draftoff:name', r.name); } catch { /* ignore */ }
      } catch (ex) { err.textContent = ex.message; return; }
    }
    await act('vote', { team: ui.team, mvp: ui.mvp }, 'Vote saved');
  } }, s.myVote ? 'Update my vote' : 'Cast my vote'));
  if (me && me.host) {
    kids.push(h('button', { class: 'btn ghost wide', id: 'reveal', style: 'margin-top:8px', disabled: !s.voters.length, onclick: () => confirm('Reveal the results now? Voting closes for everyone.') && act('reveal', {}, 'Results revealed') }, 'Reveal results now'));
    const voted = new Set(s.voters);
    const waiting = s.members.filter((m) => !voted.has(m.id)).map((m) => m.name);
    if (waiting.length && s.voters.length) kids.push(h('p', { class: 'muted small', style: 'margin:8px 0 0' }, `Not voted yet: ${waiting.join(', ')}`));
  }
  return h('div', { class: 'card', id: 'vote' }, kids);
}

// ---------- Results ----------
function resultCard() {
  const r = s.result;
  const ds = drafters();
  const win = r.winners.map(nameOf);
  const pod = r.pickOfDraft ? s.picks.find((p) => p.n === r.pickOfDraft.n) : null;
  const max = Math.max(1, ...Object.values(r.counts));
  const headline = !win.length ? 'No votes were cast' : win.length > 1 ? `🏆 ${win.join(' & ')} tie!` : `🏆 ${win[0]}’s team wins`;
  const again = s.topic ? `/?t=${encodeURIComponent(s.topic)}` : `/?title=${encodeURIComponent(s.title)}`;
  return h('div', { class: 'side', id: 'result' },
    h('div', { class: 'card result-hero' }, h('div', { class: 'small' }, s.title), h('h2', { id: 'winner' }, headline),
      h('p', { class: 'muted', style: 'margin:0' }, `${r.total} ${r.total === 1 ? 'vote' : 'votes'}`, pod ? ` · ⭐ Pick of the draft: ${pod.item} (${nameOf(pod.memberId)})` : '')),
    h('div', { class: 'card' }, h('h3', {}, 'Votes'), ds.slice().sort((a, b) => r.counts[b.id] - r.counts[a.id]).map((d) =>
      h('div', { style: 'margin-bottom:10px' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', {}, d.name), h('span', {}, `${r.counts[d.id]} ${r.counts[d.id] === 1 ? 'vote' : 'votes'}`)),
        h('div', { class: 'bar' }, h('i', { style: `width:${(r.counts[d.id] / max) * 100}%` }))))),
    h('div', { class: 'card' }, h('h3', {}, 'Share the result'), h('div', { class: 'sharebar' },
      h('button', { class: 'btn hot', id: 'cardbtn', onclick: shareCard }, 'Share result card'),
      h('button', { class: 'btn ghost', onclick: () => invite(`${headline.replace('🏆 ', '')} in our “${s.title}” draft. See the boards:`) }, 'Share link'))),
    h('div', { class: 'card' }, h('h3', {}, 'Your turn to host'), h('p', { class: 'muted small' }, 'Same chat, new argument. Or send this topic to another group and compare.'),
      h('div', { class: 'sharebar' }, h('a', { class: 'btn', href: '/', id: 'another' }, 'Draft another topic'), h('a', { class: 'btn ghost', href: again, id: 'challenge' }, 'Run this topic in another group'))));
}

async function shareCard() {
  const blob = await renderCard(s, nameOf);
  const file = new File([blob], 'draftoff-result.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: s.title, text: `${link()}` }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: 'draftoff-result.png' });
  document.body.append(a); a.click(); a.remove();
  toast('Result card saved');
}

// ---------- Side panel ----------
function people() {
  const voted = new Set(s.voters);
  const host = s.me && s.me.host;
  const row = (m) => h('li', {}, h('span', {}, m.name, s.me && m.id === s.me.id ? ' (you)' : '', ' ', h('span', { class: 'tag' }, m.host ? 'host' : m.role === 'drafter' ? 'drafter' : 'voter')),
    h('span', {}, s.status === 'voting' && voted.has(m.id) ? h('span', { class: 'tag' }, '✓ voted') : '',
      host && !m.host && (s.status === 'lobby' || m.role === 'voter') ? h('button', { class: 'x', title: `Remove ${m.name}`, 'aria-label': `Remove ${m.name}`, onclick: () => confirm(`Remove ${m.name}?`) && act('remove', { memberId: m.id }, 'Removed') }, '×') : ''));
  const ds = s.members.filter((m) => m.role === 'drafter');
  const vs = s.members.filter((m) => m.role === 'voter');
  return h('div', { class: 'card', id: 'people' }, h('h3', {}, `People (${s.members.length})`), h('ul', { class: 'people' }, ds.map(row), vs.map(row)),
    vs.length ? null : h('p', { class: 'muted small', style: 'margin:8px 0 0' }, 'Voters decide the winner, so invite the rest of the chat.'));
}

function mePanel() {
  if (!s.me) return null;
  const tok = tokenFor(id);
  const kids = [h('h3', {}, 'You'), h('p', { class: 'small muted', style: 'margin:0 0 10px' }, `Joined as ${s.me.name}. This device remembers you.`),
    h('div', { class: 'row' }, h('button', { class: 'btn small ghost', id: 'private', onclick: async () => toast((await copy(`${link()}#k=${tok}`)) ? 'Private link copied. Open it on another device to continue as you. Don’t share it.' : 'Could not copy') }, 'Private link'))];
  if (!s.me.host && (s.me.role === 'voter' || s.status === 'lobby') && s.status !== 'done') {
    kids[2].append(h('button', { class: 'btn small danger', onclick: async () => { if (confirm('Leave this draft?') && (await act('remove', {}, 'You left the draft'))) { saveMine(id, null); load(true); } } }, 'Leave'));
  }
  if (s.me.host) {
    kids[2].append(h('button', { class: 'btn small danger', id: 'delete', onclick: async () => {
      if (!confirm('Delete this draft for everyone? This cannot be undone.')) return;
      try { await api(`/d/${id}`, { method: 'DELETE', token: tok }); saveMine(id, null); location.href = '/'; } catch (e) { toast(e.message); }
    } }, 'Delete draft'));
  }
  return h('div', { class: 'card' }, kids);
}

function render() {
  if (!s) return;
  // Keep focus and caret in the pick box across re-renders.
  const active = document.activeElement && document.activeElement.id;
  const caret = active === 'pick' ? document.activeElement.selectionStart : null;
  const typed = {};
  for (const k of ['joinname', 'votename']) { const el = document.getElementById(k); if (el) typed[k] = el.value; }
  const main = [];
  const side = [];
  if (!s.me && s.status !== 'done' && s.status !== 'voting') main.push(joinCard());
  if (s.status === 'lobby' && s.me) main.push(lobbyCard());
  if (s.status === 'drafting') main.push(clockCard(), h('div', { id: 'nudge' }));
  if (s.status === 'voting') main.push(voteCard());
  if (s.status === 'done') main.push(resultCard());
  main.push(board());
  if (s.status === 'drafting' || s.status === 'voting') side.push(feed());
  side.push(people(), mePanel());
  const nudge = document.getElementById('nudge');
  app.replaceChildren(header(), h('div', { class: 'layout' }, h('div', { class: 'side' }, main), h('div', { class: 'side' }, side)));
  if (nudge && nudge.childElementCount && document.getElementById('nudge')) document.getElementById('nudge').replaceWith(nudge);
  for (const [k, v] of Object.entries(typed)) { const el = document.getElementById(k); if (el) el.value = v; }
  if (s.status !== 'drafting' || !s.me || !s.clock || s.clock.memberId !== s.me.id) document.title = `${s.title} · Draftoff`;
  if (active) {
    const el = document.getElementById(active);
    if (el && el.tagName === 'INPUT') { el.focus(); if (caret != null) el.setSelectionRange(caret, caret); }
  }
}

// Countdown ticks without re-rendering; poll the API every few seconds while visible.
setInterval(() => {
  for (const el of document.querySelectorAll('[data-ends]')) {
    const rest = Number(el.dataset.ends) - nowS();
    el.textContent = left(rest);
    if (rest <= 0 && !el.dataset.fired) { el.dataset.fired = '1'; setTimeout(() => load(true), 1500); }
  }
}, 1000);
// Poll every 4 s while drafting, every 10 s otherwise (stays inside the free plan's request budget).
let lastPoll = 0;
setInterval(() => {
  if (document.visibilityState !== 'visible' || !s || s.status === 'done') return;
  const every = s.status === 'drafting' ? 4000 : 10000;
  if (Date.now() - lastPoll < every) return;
  lastPoll = Date.now();
  load();
}, 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
load(true);
