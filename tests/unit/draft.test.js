import test from 'node:test';
import assert from 'node:assert/strict';
import { snakeIndex, norm, isTaken, autoPick, parsePool, onClock, catchUp, tally, pickOfDraft, shuffle, totalPicks } from '../../public/draft.js';

test('snake order reverses every other round', () => {
  const seq = Array.from({ length: 9 }, (_, n) => snakeIndex(n, 3));
  assert.deepEqual(seq, [0, 1, 2, 2, 1, 0, 0, 1, 2]);
  assert.deepEqual(Array.from({ length: 4 }, (_, n) => snakeIndex(n, 2)), [0, 1, 1, 0]);
  assert.equal(totalPicks(4, 6), 24);
});

test('every drafter gets exactly one pick per round', () => {
  for (let k = 2; k <= 8; k++) for (let r = 0; r < 8; r++) {
    const got = new Set(Array.from({ length: k }, (_, i) => snakeIndex(r * k + i, k)));
    assert.equal(got.size, k);
  }
});

test('duplicate check ignores case, accents, punctuation and a leading "the"', () => {
  assert.equal(norm('The Polar Express'), norm('polar express!'));
  assert.equal(norm('Amélie'), norm('amelie'));
  assert.equal(norm('Fish & Chips'), norm('fish and chips'));
  assert.notEqual(norm('Elf'), norm('Elves'));
  const picks = [{ item: 'Die Hard' }, { item: null }];
  assert.ok(isTaken('die hard', picks));
  assert.ok(!isTaken('Die Hard 2', picks));
});

test('autopick takes the first untaken pool item, null when the pool is used up', () => {
  const pool = ['Home Alone', 'Elf', 'Love Actually'];
  assert.equal(autoPick(pool, [{ item: 'home alone' }]), 'Elf');
  assert.equal(autoPick(pool, pool.map((item) => ({ item }))), null);
  assert.equal(autoPick([], []), null);
});

test('parsePool strips numbering and bullets, splits commas, dedupes', () => {
  assert.deepEqual(parsePool('1. Elf\n2) Home Alone\n- elf\n• Die Hard, Krampus\n\n'), ['Elf', 'Home Alone', 'Die Hard', 'Krampus']);
  assert.deepEqual(parsePool('Salt (sea, rock), Pepper'), ['Salt (sea, rock)', 'Pepper']);
});

test('onClock follows the snake and ends after the last pick', () => {
  const order = ['a', 'b', 'c'];
  assert.deepEqual(onClock(order, 2, 0), { n: 0, round: 0, memberId: 'a' });
  assert.deepEqual(onClock(order, 2, 3), { n: 3, round: 1, memberId: 'c' });
  assert.equal(onClock(order, 2, 6), null);
});

test('catchUp autopicks expired turns in order and skips when the pool is empty', () => {
  const order = ['a', 'b'];
  const base = { order, rounds: 2, timer: 100, startedAt: 1000, pool: ['X', 'Y'] };
  assert.deepEqual(catchUp({ ...base, picks: [], now: 1099 }).made, []);
  const r = catchUp({ ...base, picks: [{ n: 0, item: 'Y' }], now: 1250 });
  // pick 1 (b) expired at 1100, pick 2 (b again, snake) expired at 1200, pick 3 (a) still open
  assert.deepEqual(r.made.map((p) => [p.n, p.memberId, p.item, p.auto, p.at]), [[1, 'b', 'X', 1, 1100], [2, 'b', null, 2, 1200]]);
  assert.equal(r.startedAt, 1200);
  const all = catchUp({ ...base, picks: [], now: 99999 });
  assert.equal(all.made.length, 4); // stops at the end of the draft
  assert.deepEqual(catchUp({ ...base, timer: 0, picks: [], now: 99999 }).made, []);
});

test('tally counts team votes, shares ties, ignores votes for non-drafters', () => {
  const t = tally([{ team: 'a' }, { team: 'b' }, { team: 'a' }, { team: 'zz' }], ['a', 'b', 'c']);
  assert.deepEqual(t.counts, { a: 2, b: 1, c: 0 });
  assert.deepEqual(t.winners, ['a']);
  assert.equal(t.total, 3);
  assert.deepEqual(tally([{ team: 'a' }, { team: 'b' }], ['a', 'b']).winners, ['a', 'b']);
  assert.deepEqual(tally([], ['a', 'b']).winners, []);
});

test('pick of the draft: most votes, earlier pick wins ties', () => {
  assert.deepEqual(pickOfDraft([{ mvp: 4 }, { mvp: 2 }, { mvp: 4 }, { mvp: null }]), { n: 4, votes: 2 });
  assert.deepEqual(pickOfDraft([{ mvp: 5 }, { mvp: 3 }]), { n: 3, votes: 1 });
  assert.equal(pickOfDraft([{ mvp: null }]), null);
});

test('shuffle keeps every element', () => {
  const s = shuffle([1, 2, 3, 4, 5]);
  assert.deepEqual(s.slice().sort(), [1, 2, 3, 4, 5]);
});

test('topic packs: 30 unique slugs, 36-50 suggestions each, no duplicates under norm()', async () => {
  const { TOPICS, topicBySlug } = await import('../../public/topics.js');
  const groups = new Set(['Holiday', 'Movies & TV', 'Music', 'Food & drink', 'Sports', 'Everything else']);
  assert.equal(TOPICS.length, 30);
  assert.equal(new Set(TOPICS.map((t) => t.slug)).size, 30);
  for (const t of TOPICS) {
    assert.match(t.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(groups.has(t.group), t.slug);
    assert.ok(t.title && t.emoji, t.slug);
    assert.ok(t.pool.length >= 36 && t.pool.length <= 50, `${t.slug}: ${t.pool.length}`);
    assert.equal(new Set(t.pool.map(norm)).size, t.pool.length, `${t.slug} has a duplicate`);
    assert.ok(t.pool.every((x) => x.length <= 40), t.slug);
  }
  assert.equal(topicBySlug('christmas-movies').title, 'Best Christmas movies');
  assert.equal(topicBySlug('nope'), null);
});
