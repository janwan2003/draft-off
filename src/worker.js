// Draftoff: one Worker serves the static site and the API. Each draft is one Durable Object
// with its own SQLite database (tables in schema.sql); a small Limiter object counts requests per IP.
import { DurableObject } from 'cloudflare:workers';
import { handle, rid, KEEP_DAYS } from './api.js';
import { describe, draftPage } from './og.js';
import SCHEMA from '../schema.sql';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function withHeaders(res) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}
const ID_RE = /^[A-Za-z0-9]{6,16}$/;
const draftStub = (env, id) => env.DRAFTS.get(env.DRAFTS.idFromName(id));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === '/api/d' && request.method === 'POST') {
      const id = rid(10);
      const fwd = new Request(request, { headers: new Headers(request.headers) });
      fwd.headers.set('x-new-id', id);
      return withHeaders(await draftStub(env, id).fetch(fwd));
    }
    let m = p.match(/^\/api\/d\/([^/]+)(\/[a-z]+)?$/);
    if (m) {
      if (!ID_RE.test(m[1])) return withHeaders(Response.json({ error: 'Draft not found.' }, { status: 404 }));
      return withHeaders(await draftStub(env, m[1]).fetch(request));
    }
    if (p.startsWith('/api/')) return withHeaders(Response.json({ error: 'Not found.' }, { status: 404 }));
    m = p.match(/^\/d\/([^/]+)\/?$/);
    if (m) {
      let info = null;
      if (ID_RE.test(m[1])) { try { info = await draftStub(env, m[1]).describe(m[1]); } catch (e) { console.error(e); } }
      return withHeaders(await draftPage(env, request, info));
    }
    return withHeaders(await env.ASSETS.fetch(request));
  },
};

// Minimal D1-style wrapper over Durable Object SQLite so the API reads like plain SQL.
class Stmt {
  constructor(sql, q) { this.sql = sql; this.q = q; this.args = []; }
  bind(...a) { this.args = a.map((v) => (v === undefined ? null : v)); return this; }
  all() { return { results: this.sql.exec(this.q, ...this.args).toArray(), meta: {} }; }
  first() { return this.sql.exec(this.q, ...this.args).toArray()[0] ?? null; }
  run() {
    this.sql.exec(this.q, ...this.args).toArray();
    const c = this.sql.exec('SELECT changes() AS c').one().c;
    return { results: [], meta: { changes: c } };
  }
}

export class Draft extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    this.ready = sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'drafts'").toArray().length > 0;
    const sync = (fn) => ctx.storage.transactionSync(fn);
    const DB = {
      prepare: (q) => {
        const s = new Stmt(sql, q);
        // async-compatible API: return values directly (await works on plain values)
        return s;
      },
      batch: async (stmts) => sync(() => stmts.map((s) => (/^\s*select/i.test(s.q) ? s.all() : s.run()))),
    };
    this.apiEnv = { ...env, DB, wipe: () => this.wipe() };
  }

  init() {
    if (this.ready) return;
    for (const stmt of SCHEMA.split(';').map((x) => x.replace(/--.*$/gm, '').trim()).filter(Boolean)) this.ctx.storage.sql.exec(stmt);
    this.ready = true;
  }

  async wipe() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.ready = false;
  }

  async fetch(request) {
    const newId = request.headers.get('x-new-id');
    if (newId) {
      if (this.ready) return Response.json({ error: 'Try again.' }, { status: 409 });
      this.init();
      const res = await handle(request, { ...this.apiEnv, newId });
      if (res.status === 201) await this.ctx.storage.setAlarm(Date.now() + KEEP_DAYS * 86400_000);
      else await this.wipe();
      return res;
    }
    if (!this.ready) return Response.json({ error: 'This draft does not exist or was deleted.' }, { status: 404 });
    return handle(request, this.apiEnv);
  }

  async describe(id) {
    if (!this.ready) return null;
    return describe(this.apiEnv, id);
  }

  // Drafts are deleted KEEP_DAYS after creation.
  async alarm() { await this.wipe(); }
}

export class Limiter extends DurableObject {
  async hit(limit, windowMs) {
    const now = Date.now();
    let w = (await this.ctx.storage.get('w')) || { start: now, n: 0 };
    if (now - w.start > windowMs) w = { start: now, n: 0 };
    w.n += 1;
    await this.ctx.storage.put('w', w);
    await this.ctx.storage.setAlarm(w.start + windowMs + 1000);
    return w.n <= limit;
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}
