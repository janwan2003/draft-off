// End-to-end test in real Chromium, one browser context per person (host on desktop, friends on phones):
// create from a topic pack, join as drafters and a voter, duplicate name, start in join order, live
// "your pick" without reload, autocomplete, duplicate pick, take back a pick, host "pick for",
// voting (self-vote blocked, late voter joins while voting), hidden results, reveal, result card PNG,
// link preview text at every stage, an expiring pick clock (autopick), delete. Screenshots go to shots/.
// Usage: BASE=http://127.0.0.1:8791 node tests/e2e/run.mjs   (local server needs --var TEST_TIMER:4)
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const SHOTS = process.env.SHOTS || 'shots';
const FAST = process.env.TEST_TIMER !== '0';
fs.mkdirSync(SHOTS, { recursive: true });

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = path.join(os.homedir(), '.cache/ms-playwright');
  for (const d of fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    const p = path.join(root, d, 'chrome-linux64/chrome');
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 860 }, acceptDownloads: true };
const errors = [];
const browser = await chromium.launch({ executablePath: findChrome() });
let deleted = false;

async function person(label, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/status of 409/.test(m.text())) return; // duplicate name / taken pick are tested on purpose
    if (label === 'Ola' && /status of 400/.test(m.text())) return; // empty-title create is tested on purpose
    if (deleted && /status of 404/.test(m.text())) return;
    errors.push(`${label}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return { label, ctx, page };
}
const step = (s) => console.log('·', s);
async function shot(p, name) {
  const [sw, vw] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(sw <= vw, `${name}: page is ${sw}px wide in a ${vw}px viewport (horizontal overflow)`);
  await p.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}
async function og(url) {
  const html = await (await fetch(url)).text();
  return [html.match(/og:title" content="([^"]*)"/)[1], html.match(/og:description" content="([^"]*)"/)[1]];
}
const T = { timeout: 12000 };
async function joinAs(p, url, name, role) {
  await p.goto(url);
  await p.locator('#join').waitFor();
  if (role === 'voter') await p.getByRole('button', { name: /Just vote/ }).click();
  await p.locator('#joinname').fill(name);
  await p.locator('#joinbtn').click();
  await p.locator('#people').getByText(`${name} (you)`).waitFor(T);
}
async function pick(p, item) {
  await p.locator('#pick').waitFor(T);
  await p.locator('#pick').fill(item);
  const before = await p.locator('.board .cell[data-n]').count();
  await p.locator('#pickbtn').click();
  await p.waitForFunction((n) => document.querySelectorAll('.board .cell[data-n]').length > n, before, { timeout: 8000 });
  assert.equal(await p.locator('#pick').count() ? await p.locator('#pick').inputValue() : '', '', 'pick box is cleared');
}

const ola = await person('Ola', DESKTOP);
const kev = await person('Kevin', PHONE);
const sam = await person('Sam', { viewport: { width: 1024, height: 800 } });
const vee = await person('Vee', PHONE);
const zoe = await person('Zoe', PHONE);

step('home: topic chip fills the title, then create');
await ola.page.goto(BASE + '/');
await shot(ola.page, 'home-desktop.png');
await zoe.page.goto(BASE + '/');
await shot(zoe.page, 'home-phone.png');
await ola.page.locator('#go').click();
await ola.page.locator('#err', { hasText: 'Name the topic' }).waitFor();
await ola.page.locator('.chip', { hasText: 'Best Christmas movies' }).click();
assert.equal(await ola.page.locator('#title').inputValue(), 'Best Christmas movies');
assert.match(await ola.page.locator('#poolnote').textContent(), /suggestions included/);
await ola.page.locator('#rounds').selectOption('3');
await ola.page.locator('#timer').selectOption('0');
await ola.page.locator('#name').fill('Ola');
await ola.page.locator('#go').click();
await ola.page.waitForURL(/\/d\/[A-Za-z0-9]+$/);
const url = ola.page.url();
const id = url.split('/').pop();
await ola.page.getByText('Get your drafters in').waitFor();
assert.ok(await ola.page.locator('#start').isDisabled(), 'start needs 2 drafters');
let [t, d] = await og(url);
assert.equal(t, 'Draft: Best Christmas movies');
assert.match(d, /1 drafter so far · 3 rounds/);

step('friends join: two drafters, one voter, a duplicate name');
await joinAs(kev.page, url, 'Kevin', 'drafter');
await sam.page.goto(url);
await sam.page.locator('#joinname').fill('kevin');
await sam.page.locator('#joinbtn').click();
await sam.page.getByText('already in').waitFor();
await sam.page.locator('#joinname').fill('Sam');
await sam.page.locator('#joinbtn').click();
await sam.page.locator('#people').getByText('Sam (you)').waitFor(T);
await joinAs(vee.page, url, 'Vee', 'voter');
await shot(vee.page, 'lobby-phone.png');
[t, d] = await og(url);
assert.match(d, /3 drafters so far/);

step('host starts in join order (Ola, Kevin, Sam)');
await ola.page.locator('#start').waitFor();
await ola.page.locator('#shuffle').uncheck();
await ola.page.locator('#start').click();
await ola.page.locator('#pick').waitFor(T);
await shot(ola.page, 'pick-desktop.png');
[t] = await og(url);
assert.equal(t, 'Best Christmas movies · Round 1 of 3 · Ola on the clock');

step('Ola picks with autocomplete; Kevin sees his turn without reloading');
await ola.page.locator('#pick').fill('home al');
await ola.page.locator('#sugg li', { hasText: 'Home Alone' }).first().waitFor();
await ola.page.locator('#sugg li', { hasText: /^Home Alone$/ }).dispatchEvent('mousedown');
assert.equal(await ola.page.locator('#pick').inputValue(), 'Home Alone');
await ola.page.locator('#pickbtn').click();
await ola.page.locator('#nudgebtn').waitFor(T); // "Message Kevin" nudge after picking
await kev.page.locator('#pick').waitFor(T);   // live update via polling
await kev.page.locator('#pick').fill('the HOME alone');
await kev.page.getByText('is already taken').waitFor();
await kev.page.locator('#pick').fill('die hard');
await shot(kev.page, 'pick-phone.png');
await kev.page.locator('#pickbtn').click();
await kev.page.locator('#pick').waitFor({ state: 'detached', timeout: 8000 });
assert.ok(await kev.page.locator('.board .cell', { hasText: 'Die Hard' }).count(), 'pick stored under the pool spelling');

step('Kevin takes back his pick, picks again; snake: Sam twice in a row');
await kev.page.locator('#undo').click();
await kev.page.locator('#pick').waitFor(T);
await pick(kev.page, 'Die Hard');
await pick(sam.page, 'Elf');
await pick(sam.page, 'Klaus');
[t, d] = await og(url);
assert.equal(t, 'Best Christmas movies · Round 2 of 3 · Kevin on the clock');
assert.match(d, /Last pick: Sam took Klaus/);

step('host picks for Kevin (autopick from the pool), then the rest of the draft');
await ola.page.locator('#pickfor').click({ timeout: 12000 });
await ola.page.locator('#pick').waitFor(T);
const autoName = (await ola.page.locator('.board .cell.auto').textContent()).replace(/^#\d+/, '');
assert.equal(autoName, 'Love Actually'); // first untaken item of the pool
await pick(ola.page, 'Gremlins');
await pick(ola.page, 'Scrooged');
await pick(kev.page, 'The Muppet Christmas Carol');
await pick(sam.page, 'Arthur Christmas');
await shot(ola.page, 'board-desktop.png');

step('voting: self-vote blocked, results hidden, late voter joins with a name');
await vee.page.locator('#vote').waitFor(T);
[t, d] = await og(url);
assert.equal(t, 'Best Christmas movies · Vote for the best team');
assert.equal(await kev.page.locator('.team[data-team="Kevin"]').isDisabled(), true);
await kev.page.locator('.team[data-team="Sam"]').click();
await kev.page.locator('#votebtn').click();
await kev.page.getByText('Your vote is in').waitFor(T);
await vee.page.locator('.team[data-team="Sam"]').click();
await vee.page.locator('#mvp').selectOption({ label: 'Klaus (Sam, #4)' });
await shot(vee.page, 'vote-phone.png');
await vee.page.locator('#votebtn').click();
await vee.page.getByText('Your vote is in').waitFor(T);
await ola.page.locator('#vote').waitFor(T);
await ola.page.locator('.team[data-team="Kevin"]').click();
await ola.page.locator('#votebtn').click();
await ola.page.getByText('Your vote is in').waitFor(T);
await zoe.page.goto(url);
await zoe.page.locator('.team[data-team="Sam"]').click();
await zoe.page.locator('#votename').fill('Zoe');
await zoe.page.locator('#votebtn').click();
await zoe.page.getByText('Your vote is in').waitFor(T);
assert.equal(await zoe.page.locator('#result').count(), 0, 'results stay hidden until reveal');
const api = await (await fetch(`${BASE}/api/d/${id}`)).json();
assert.equal(api.result, undefined, 'API hides the tally during voting');
assert.equal(api.voters.length, 4);

step('host reveals; winner and pick of the draft everywhere');
await ola.page.locator('#reveal').click({ timeout: 12000 });
await ola.page.locator('#winner').waitFor(T);
assert.equal(await ola.page.locator('#winner').textContent(), '🏆 Sam’s team wins');
await vee.page.locator('#winner').waitFor(T);
assert.match(await vee.page.locator('#result').textContent(), /Pick of the draft: Klaus/);
await shot(vee.page, 'result-phone.png');
await shot(ola.page, 'result-desktop.png');
[t, d] = await og(url);
assert.equal(t, '🏆 Sam’s team won “Best Christmas movies”');
assert.match(d, /^3–1 on 4 votes/);
assert.equal(await vee.page.locator('#challenge').getAttribute('href'), '/?t=christmas-movies');

step('result card is a 1080-wide PNG (1080-1350 tall)');
const [dl] = await Promise.all([ola.page.waitForEvent('download'), ola.page.locator('#cardbtn').click()]);
const file = path.join(SHOTS, 'result-card.png');
await dl.saveAs(file);
const png = fs.readFileSync(file);
assert.equal(png.readUInt32BE(16), 1080);
const ph = png.readUInt32BE(20);
assert.ok(ph >= 1080 && ph <= 1350, `card height ${ph}`);

step('"Run this topic in another group" pre-fills the home form');
await vee.page.locator('#challenge').click();
await vee.page.waitForURL(/\?t=christmas-movies/);
assert.equal(await vee.page.locator('.chip[aria-pressed="true"]').textContent(), '🎄 Best Christmas movies');
await vee.page.goto(BASE + '/');
await vee.page.locator('#minebox').getByText('Best Christmas movies').waitFor();

if (FAST) {
  step('pick clock: an expired turn is autopicked from the pool');
  const post = (p, body, tok) => fetch(BASE + '/api' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { 'x-token': tok } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
  const c = await post('/d', { title: 'Best snacks', name: 'A', rounds: 3, timer: Number(process.env.TEST_TIMER || 4), topic: 'snacks' });
  await post(`/d/${c.id}/join`, { name: 'B', role: 'drafter' });
  await post(`/d/${c.id}/start`, { shuffle: false }, c.token);
  await new Promise((r) => setTimeout(r, 9500));
  const st = await (await fetch(`${BASE}/api/d/${c.id}`)).json();
  assert.ok(st.picks.length >= 2 && st.picks.every((p) => p.auto === 1 && p.item), JSON.stringify(st.picks));
  assert.equal(st.picks[0].memberId, st.order[0]);
  assert.equal(st.picks[1].memberId, st.order[1]);
  const res = await fetch(`${BASE}/api/d/${c.id}`, { method: 'DELETE', headers: { 'x-token': c.token } });
  assert.equal(res.status, 200);
}

step('host deletes the draft; the link shows "not found"');
deleted = true;
await ola.page.locator('#delete').click();
await ola.page.waitForURL(BASE + '/');
await kev.page.goto(url);
await kev.page.getByText('Draft not found').waitFor();
assert.equal((await fetch(`${BASE}/api/d/${id}`)).status, 404);

await browser.close();
if (errors.length) {
  console.error('Console errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('E2E PASS');
