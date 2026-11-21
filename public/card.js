// Result card: a 1080x1350 PNG of every team's picks, the winner and the pick of the draft.
export async function renderCard(s, nameOf) {
  const W = 1080;
  const perRow0 = s.order.length <= 4 ? s.order.length : Math.ceil(s.order.length / 2);
  const rows0 = Math.ceil(s.order.length / perRow0);
  const most = Math.max(1, ...s.order.map((m) => s.picks.filter((p) => p.memberId === m).length));
  // Tall enough for the longest team (each pick up to two lines), between square and 4:5.
  const H = Math.round(Math.min(1350, Math.max(1080, 370 + 120 + rows0 * (110 + most * 2 * 40) + (rows0 - 1) * 18)));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  // Split text into at most `lines` lines that fit `max` px; the last line gets an ellipsis if needed.
  const wrap = (text, max, lines) => {
    const words = String(text).split(' ');
    const out = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width <= max || !cur) cur = t;
      else { out.push(cur); cur = w; }
    }
    out.push(cur);
    if (out.length > lines) { out.length = lines; out[lines - 1] += ' …'; }
    return out.map((l) => { let t = l; while (g.measureText(t).width > max && t.length > 1) t = t.slice(0, -2) + '…'; return t; });
  };
  const fit = (text, max, w, px) => { g.font = font(w, px); let t = String(text); while (g.measureText(t).width > max && t.length > 1) t = t.slice(0, -2) + '…'; return t; };

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0e7a63'); bg.addColorStop(1, '#083d33');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  g.fillStyle = 'rgba(255,255,255,.75)'; g.font = font(800, 30); g.fillText('DRAFTOFF', 70, 100);
  g.fillStyle = '#fff'; g.font = font(800, 62); g.fillText(fit(s.title, W - 140, 800, 62), 70, 180);

  const r = s.result;
  const win = r.winners.map(nameOf);
  const head = !win.length ? 'No votes were cast' : win.length > 1 ? `${win.join(' & ')} tie` : `${win[0]}’s team wins`;
  g.fillStyle = '#f2a516'; g.font = font(900, 50); g.fillText(fit('🏆 ' + head, W - 140, 900, 50), 70, 262);
  const pod = r.pickOfDraft ? s.picks.find((p) => p.n === r.pickOfDraft.n) : null;
  g.fillStyle = 'rgba(255,255,255,.85)'; g.font = font(600, 30);
  g.fillText(fit(`${r.total} ${r.total === 1 ? 'vote' : 'votes'}${pod ? ` · ⭐ Pick of the draft: ${pod.item}` : ''}`, W - 140, 600, 30), 70, 316);

  // Teams in columns (up to 4 per row, two rows for 5-8 drafters).
  const ds = s.order;
  const perRow = ds.length <= 4 ? ds.length : Math.ceil(ds.length / 2);
  const rowsN = Math.ceil(ds.length / perRow);
  const top = 370, bottom = H - 120, gap = 18;
  const colW = (W - 140 - gap * (perRow - 1)) / perRow;
  const rowH = (bottom - top - gap * (rowsN - 1)) / rowsN;
  const winners = new Set(r.winners);
  ds.forEach((mid, i) => {
    const x = 70 + (i % perRow) * (colW + gap);
    const y = top + Math.floor(i / perRow) * (rowH + gap);
    g.fillStyle = winners.has(mid) ? '#fff6d9' : '#ffffff';
    roundRect(g, x, y, colW, rowH, 22); g.fill();
    g.fillStyle = winners.has(mid) ? '#7a5200' : '#10201d';
    const px = perRow > 3 ? 28 : 34;
    g.font = font(800, px);
    g.fillText(fit(`${winners.has(mid) ? '🏆 ' : ''}${nameOf(mid)}`, colW - 40, 800, px), x + 20, y + 20 + px);
    g.fillStyle = '#5d6b68'; g.font = font(700, px - 8);
    g.fillText(`${r.counts[mid] || 0} ${(r.counts[mid] || 0) === 1 ? 'vote' : 'votes'}`, x + 20, y + 30 + px * 2);
    const picks = s.picks.filter((p) => p.memberId === mid);
    const avail = rowH - (50 + px * 2);
    const fpx = Math.max(18, Math.min(px - 4, Math.floor(avail / Math.max(picks.length, 1) / 2.6)));
    let yy = y + 50 + px * 2 + 4;
    picks.forEach((p, j) => {
      g.fillStyle = pod && p.n === pod.n ? '#c98300' : p.item ? '#10201d' : '#9aa6a3';
      g.font = font(600, fpx);
      for (const line of wrap(`${j + 1}. ${p.item || 'skipped'}`, colW - 40, 2)) {
        yy += fpx * 1.25;
        g.fillText(line, x + 20, yy);
      }
      yy += fpx * 0.45;
    });
  });
  g.fillStyle = 'rgba(255,255,255,.8)'; g.font = font(700, 30);
  g.fillText('Draft your own topic · pb-draft-off.jan-bef.workers.dev', 70, H - 60);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
