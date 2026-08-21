// On-demand recall hook — Layer 2 of the token-saving playbook.
// 提取自生产环境 DSH preset bootstrap（2026-08-21），真实 ID/路径已脱敏为 env 配置。
//
// 行为：每个真人回合注入一次「按当前消息检索」的小摘要 section：
//   - query = 最后一条真人 user 消息原文（<8 字符跳过）
//   - 并行查 /search/memories + /search/conversations，各取前几条格式化
//   - 总预算 ≤600 字符；2s 超时；30s 同文缓存；任何失败静默返回 null
//
// 接入点：在会话 assemble/system 组装处调用 buildRecallSection(session)，
// 把返回的 { name, order, text } 追加进 sections。其他栈（Claude Code hooks、
// 自建 agent loop）同理：在每轮 system prompt 组装时插入这段文字即可。

import { readFileSync } from 'node:fs'

// ── 配置（全部可用环境变量覆盖）───────────────────────────────
const TDAI_CORE = process.env.TDAI_GATEWAY ?? 'http://127.0.0.1:8420'
const TDAI_TEAM = process.env.TDAI_TEAM_ID ?? ''            // ← 你的 team id
const TDAI_ADMIN_KEY_FILE = process.env.TDAI_ADMIN_KEY_FILE ?? '' // ← 密钥文件路径

const RECALL_MIN_CHARS = 8
const RECALL_TIMEOUT_MS = 2000
const RECALL_TTL_MS = 30_000
const RECALL_MAX_TEXT = 600

const recallCache = new Map()    // session.id -> { text, ts, section }
const recallInflight = new Map() // session.id -> Promise<section|null>

function readTdaiKey() {
  try { return readFileSync(TDAI_ADMIN_KEY_FILE, 'utf8').trim() } catch { return '' }
}

function userTextOf(data) {
  if (!data || typeof data !== 'object') return ''
  const payload = data && typeof data.message === 'object' && data.message !== null ? data.message : data
  const content = Array.isArray(payload.content) ? payload.content : []
  return content.map((c) => (typeof c === 'string' ? c : (c && c.text ? c.text : ''))).join(' ').trim()
}

async function tdaiSearch(path, payload) {
  const key = readTdaiKey()
  if (!key || !TDAI_TEAM) return null
  try {
    const res = await fetch(TDAI_CORE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ ...payload, team_id: TDAI_TEAM }),
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

/** 记忆条目格式化：只取 "- **[type]** ..." 行，最多 3 条。 */
function fmtMemories(json) {
  if (!json || typeof json.results !== 'string') return ''
  const out = []
  for (const line of json.results.split('\n')) {
    if (/^\s*- \*\*/.test(line)) {
      out.push('• ' + line.replace(/^\s*- \*\*/, '').replace(/\*\*/g, '').slice(0, 120))
      if (out.length >= 3) break
    }
  }
  return out.length ? '记忆：\n' + out.join('\n') : ''
}

/** 历史对话格式化：按 "---" 分块，取正文前 150 字，最多 2 条。 */
function fmtConversations(json) {
  if (!json || typeof json.results !== 'string') return ''
  const blocks = json.results.split(/\n---\n/)
  const out = []
  for (const block of blocks) {
    const m = block.match(/\[(user|assistant)\].*?Session: ([^\[]+)\[([^\]]+)\]/)
    const body = block.split('\n\n').slice(1).join(' ').trim()
    if (body) {
      out.push(`${m ? `[${m[1]} ${m[3]}]` : '[过往]'} ${body.slice(0, 150)}`)
      if (out.length >= 2) break
    }
  }
  return out.length ? '过往：\n' + out.join('\n') : ''
}

/** 从会话事件里找最后一条「真人」user 消息（过滤系统合成消息）。 */
function lastRealUserText(session) {
  const events = session?.events ?? []
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]
    if (ev?.type !== 'user/message') continue
    const data = ev.data ?? {}
    if (data.source != null && data.source.kind !== 'user') continue
    const text = userTextOf(data)
    if (text) return text
  }
  return ''
}

/**
 * 构建召回 section。返回 null = 本轮不注入（无消息/太短/无命中/出错）。
 * 生产版另带 firstUserText 首轮兜底 map，此处从简。
 */
export async function buildRecallSection(session) {
  try {
    const text = lastRealUserText(session)
    if (!text || text.length < RECALL_MIN_CHARS) return null
    const now = Date.now()
    const cached = recallCache.get(session.id)
    if (cached && cached.text === text && now - cached.ts < RECALL_TTL_MS) return cached.section
    if (recallInflight.has(session.id)) return recallInflight.get(session.id).catch(() => null)
    const timer = () => new Promise((resolve) => setTimeout(() => resolve(null), RECALL_TIMEOUT_MS))
    const p = (async () => {
      const mem = await Promise.race([tdaiSearch('/search/memories', { query: text, limit: 3 }), timer()])
      const conv = await Promise.race([tdaiSearch('/search/conversations', { query: text, limit: 2 }), timer()])
      const parts = [fmtMemories(mem), fmtConversations(conv)].filter(Boolean)
      if (parts.length === 0) return null
      const joined = parts.join('\n\n')
      return { name: 'tdai-recall', order: 1010, text: '【TDAI 自动召回（按当前消息）】\n' + joined.slice(0, RECALL_MAX_TEXT) }
    })()
    recallInflight.set(session.id, p)
    try {
      const section = await p
      if (section) recallCache.set(session.id, { text, ts: now, section })
      return section
    } finally {
      recallInflight.delete(session.id)
    }
  } catch { return null }
}
