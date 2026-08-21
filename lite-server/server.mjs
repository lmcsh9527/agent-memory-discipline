#!/usr/bin/env node
/**
 * memory-lite — zero-dependency standalone memory service.
 *
 * Implements the three HTTP endpoints our token-saving components use, with the
 * same request/response shapes as TencentDB Agent Memory (MIT):
 *
 *   POST /v3/conversation/add    store one conversation turn-pair
 *   POST /search/memories        keyword search over memory entries
 *   POST /search/conversations   keyword search over stored conversations
 *   POST /memories/add           seed a memory entry (lite-specific helper)
 *   GET  /health                 liveness probe
 *
 * Quick start:   node server.mjs            (http://127.0.0.1:8420)
 * Config (env):  PORT=8420  MEMORY_LITE_FILE=./data/memory.json
 *                MEMORY_LITE_KEY=secret     (optional bearer auth)
 *
 * Upgrade path: point your gateway at a full TencentDB Agent Memory instance
 * for semantic search / L1-L3 distillation / memory panel — same API shape,
 * no client changes needed. https://github.com/TencentCloud/TencentDB-Agent-Memory
 */

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.PORT || 8420);
const DATA_FILE = process.env.MEMORY_LITE_FILE || join(process.cwd(), 'data', 'memory.json');
const AUTH_KEY = process.env.MEMORY_LITE_KEY || '';

// ── storage ──────────────────────────────────────────────────────────────
// One JSON file, written atomically after each mutation. Fine for a personal
// assistant workload (thousands of turns); swap for SQLite/TDAI when bigger.
function loadDb() {
  try {
    if (existsSync(DATA_FILE)) return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error(`[memory-lite] failed to read ${DATA_FILE}: ${e.message}`);
  }
  return { memories: [], conversations: [] };
}
const db = loadDb();
let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      mkdirSync(dirname(DATA_FILE), { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      writeFileSync(tmp, JSON.stringify(db, null, 1));
      // atomic-ish replace to avoid corrupting the file on crash
      import('node:fs').then((fs) => fs.renameSync(tmp, DATA_FILE));
    } catch (e) {
      console.error(`[memory-lite] failed to save: ${e.message}`);
    }
  }, 150);
}

// ── helpers ──────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 5e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/** Keyword scorer: full-query substring hits weigh most, then per-term hits. */
function score(text, query) {
  const t = String(text).toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  let s = t.includes(q) ? 10 : 0;
  for (const term of q.split(/[\s,，。.;；、!！?？]+/).filter((w) => w.length > 1)) {
    if (t.includes(term)) s += 2;
  }
  return s;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function authorized(req) {
  if (!AUTH_KEY) return true;
  return (req.headers.authorization || '') === 'Bearer ' + AUTH_KEY;
}

// ── routes ───────────────────────────────────────────────────────────────
async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { status: 'ok', service: 'memory-lite', conversations: db.conversations.length, memories: db.memories.length });
  }
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('memory-lite is running.\nEndpoints: POST /v3/conversation/add · /search/memories · /search/conversations · /memories/add · GET /health\n');
  }

  if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
  if (!authorized(req)) return json(res, 401, { error: 'unauthorized' });

  const body = await readBody(req);

  // ── write: one turn-pair in, an id out (shape-compatible with TDAI) ──
  if (url.pathname === '/v3/conversation/add') {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return json(res, 400, { error: 'messages[] required' });
    const rec = {
      id: 'cnv-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      team_id: body.team_id || '',
      agent_id: body.agent_id || '',
      user_id: body.user_id || '',
      session: body.session || '',
      ts: new Date().toISOString(),
      messages: messages.map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 20000) })),
    };
    db.conversations.push(rec);
    saveDb();
    return json(res, 200, { data: { accepted_ids: [rec.id], l0_recorded: messages.length } });
  }

  // ── lite-specific: seed a memory entry ──
  if (url.pathname === '/memories/add') {
    if (!body.body) return json(res, 400, { error: 'body required' });
    const mem = {
      id: 'mem-' + Date.now().toString(36),
      type: body.type || 'fact',
      priority: body.priority || 60,
      scene: body.scene || '',
      body: String(body.body),
      ts: new Date().toISOString(),
    };
    db.memories.push(mem);
    saveDb();
    return json(res, 200, { data: { id: mem.id } });
  }

  // ── read: memories (text format matches what recall hooks parse) ──
  if (url.pathname === '/search/memories') {
    const query = String(body.query || '');
    const limit = Math.min(Number(body.limit) || 5, 20);
    const hits = db.memories
      .map((m) => ({ m, s: score(`${m.type} ${m.scene} ${m.body}`, query) }))
      .filter((h) => h.s > 0)
      .sort((a, b) => b.s - a.s || (a.m.ts < b.m.ts ? 1 : -1))
      .slice(0, limit);
    const lines = hits.map(({ m, s }) =>
      `- **[${m.type}]** (priority: ${m.priority})${m.scene ? ` [scene: ${m.scene}]` : ''} (score: ${(s / 10).toFixed(3)})\n  ${m.body}`
    );
    return json(res, 200, { results: `Found ${lines.length} matching memories:\n\n${lines.join('\n')}` });
  }

  // ── read: past conversations ──
  if (url.pathname === '/search/conversations') {
    const query = String(body.query || '');
    const limit = Math.min(Number(body.limit) || 3, 10);
    const hits = [];
    for (const c of db.conversations) {
      const text = c.messages.map((m) => `[${m.role}] ${m.content}`).join('\n');
      const s = score(text, query);
      if (s > 0) hits.push({ c, s, text });
    }
    hits.sort((a, b) => b.s - a.s || (a.c.ts < b.c.ts ? 1 : -1));
    const blocks = hits.slice(0, limit).map(({ c, text }) => `**[user]** Session: ${c.session || '(unknown)'} [${c.ts}]\n\n${text.slice(0, 500)}`);
    return json(res, 200, { results: `Found ${blocks.length} matching message(s):\n\n${blocks.join('\n\n---\n\n')}` });
  }

  return json(res, 404, { error: 'unknown endpoint ' + url.pathname });
}

createServer((req, res) => {
  route(req, res).catch((e) => json(res, 400, { error: e.message }));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[memory-lite] listening on http://127.0.0.1:${PORT}`);
  console.log(`[memory-lite] data file: ${DATA_FILE}${AUTH_KEY ? ' (bearer auth ON)' : ''}`);
});
