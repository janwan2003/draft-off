import { api, saveMine, loadMine, h, ago } from './common.js';
import { TOPICS, topicBySlug } from './topics.js';

const $ = (s) => document.querySelector(s);
const form = $('#create');
const title = $('#title');
let topic = null;

function renderTopics() {
  const box = $('#topics');
  box.textContent = '';
  const groups = [...new Set(TOPICS.map((t) => t.group))];
  for (const g of groups) {
    box.append(h('div', { class: 'topicgroup' }, g));
    box.append(h('div', { class: 'chips' }, TOPICS.filter((t) => t.group === g).map((t) =>
      h('button', { type: 'button', class: 'chip', 'aria-pressed': String(topic === t), 'data-slug': t.slug, onclick: () => choose(topic === t ? null : t) }, `${t.emoji} ${t.title}`))));
  }
}
function choose(t) {
  topic = t;
  if (t) title.value = t.title;
  for (const c of document.querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(!!t && c.dataset.slug === t.slug));
  $('#poolnote').textContent = t ? `${t.pool.length} suggestions included: they autocomplete as you type and fill in a pick if the timer runs out.` : '';
  $('#custompool').classList.toggle('hidden', !!t);
}

title.addEventListener('input', () => {
  // Typing a different topic drops the pack unless the title still names it.
  if (topic && !title.value.trim()) choose(null);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#err');
  err.textContent = '';
  const btn = $('#go');
  btn.disabled = true;
  try {
    const r = await api('/d', {
      method: 'POST',
      body: {
        title: title.value,
        name: $('#name').value,
        rounds: Number($('#rounds').value),
        timer: Number($('#timer').value),
        topic: topic ? topic.slug : null,
        pool: topic ? '' : $('#pool').value,
      },
    });
    saveMine(r.id, { token: r.token, memberId: r.memberId, name: r.name, title: title.value.trim(), host: true });
    try { localStorage.setItem('draftoff:name', r.name); } catch { /* ignore */ }
    location.href = `/d/${r.id}`;
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
});

function renderMine() {
  const all = Object.entries(loadMine()).sort((a, b) => b[1].at - a[1].at).slice(0, 12);
  if (!all.length) return;
  $('#minebox').classList.remove('hidden');
  $('#mine').append(...all.map(([id, m]) => h('a', { href: `/d/${id}` }, h('span', {}, m.title || 'Draft'), h('span', { class: 'muted small' }, ago(Math.floor(m.at / 1000))))));
}

// Prefill from "draft another topic" / "challenge another group" links: /?t=slug or /?title=...
const q = new URLSearchParams(location.search);
renderTopics();
const pre = topicBySlug(q.get('t') || '');
if (pre) choose(pre);
else if (q.get('title')) title.value = q.get('title').slice(0, 80);
else choose(null);
try { const n = localStorage.getItem('draftoff:name'); if (n) $('#name').value = n; } catch { /* ignore */ }
renderMine();
