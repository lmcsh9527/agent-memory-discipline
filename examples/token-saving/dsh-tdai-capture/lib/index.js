import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import z from 'schemastery';

export const name = '@example/dsh-tdai-capture';
// 本插件不需要 LLM；仅用事件总线。
export const inject = [];

export const Config = z.object({
  gateway: z.string().default('http://127.0.0.1:8420'),
  teamId: z.string().default(''),   // ← 配置你的记忆库 team id
  agentId: z.string().default(''),  // ← 配置你的 agent id
  userId: z.string().default(''),   // ← 配置你的 user id
  adminKeyFile: z.string().default(''),
  adminKey: z.string().default(''),           // 兼容旧字段；v2 推荐 adminKeyFile
  logFile: z.string().default(''),            // 显式钉死，与健康守卫 CAPLOG 保持一致
  maxTextLen: z.number().default(8000),
  maxStateLines: z.number().default(5000),    // state.jsonl 裁剪上限，防无限膨胀
  maxRetries: z.number().default(3),
});

export function apply(ctx, config) {
  // ── 幂等守卫：同一进程内 apply 只执行一次（防多重注册双 apply）──
  if (apply._done) return;
  apply._done = true;

  const SHORT = 'dsh-tdai-capture';
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const logFile = config.logFile || join(dshHome, 'tdai-capture', SHORT + '.log');
  const stateFile = join(dirname(logFile), 'state.jsonl');

  const log = (level, msg) => {
    try {
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(logFile, `[${new Date().toISOString()}] [${level}] ${msg}\n`);
    } catch { /* 日志失败静默，不影响主流程 */ }
  };

  // ── adminKey 解析：adminKeyFile 优先；启动期读不到 → fail-loud ──
  let adminKey = '';
  if (config.adminKeyFile) {
    try {
      adminKey = readFileSync(config.adminKeyFile, 'utf8').trim();
    } catch (e) {
      throw new Error(`${name}: 无法读取 adminKeyFile "${config.adminKeyFile}": ${String(e)}`);
    }
    if (!adminKey) throw new Error(`${name}: adminKeyFile "${config.adminKeyFile}" 内容为空`);
  } else if (config.adminKey) {
    adminKey = config.adminKey.trim();
    log('warn', '使用旧字段 adminKey（明文配置）；v2 推荐 adminKeyFile 引用密钥文件');
  }
  if (!adminKey) throw new Error(`${name}: 未配置 adminKeyFile/adminKey，拒绝启动（fail-loud）`);

  // ── state.jsonl：持久化去重（sessionKey → Set(turn)）──
  const written = new Map(); // sessionKey -> Set(turn)
  const pending = new Map(); // sessionKey -> {turn, userText, assistantText, attempts}
  if (existsSync(stateFile)) {
    try {
      for (const line of readFileSync(stateFile, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line);
          if (rec && rec.sessionKey && rec.turn !== undefined && rec.status === 'ok') {
            if (!written.has(rec.sessionKey)) written.set(rec.sessionKey, new Set());
            written.get(rec.sessionKey).add(rec.turn);
          }
        } catch { /* 单行损坏跳过 */ }
      }
      const total = [...written.values()].reduce((n, s) => n + s.size, 0);
      log('info', `已加载去重状态：${total} 条`);
    } catch (e) {
      log('warn', `state.jsonl 读取失败（忽略继续）: ${String(e).slice(0, 200)}`);
    }
  }

  function pruneState() {
    try {
      if (!existsSync(stateFile)) return;
      const lines = readFileSync(stateFile, 'utf8').split('\n').filter(Boolean);
      if (lines.length <= config.maxStateLines) return;
      const tail = lines.slice(-config.maxStateLines);
      const tmp = stateFile + '.tmp';
      writeFileSync(tmp, tail.join('\n') + '\n');
      renameSync(tmp, stateFile);
      log('info', `state.jsonl 已裁剪：${lines.length} → ${tail.length}`);
    } catch (e) {
      log('warn', `state.jsonl 裁剪失败: ${String(e).slice(0, 200)}`);
    }
  }

  function markWritten(sessionKey, turn) {
    if (!written.has(sessionKey)) written.set(sessionKey, new Set());
    written.get(sessionKey).add(turn);
    try {
      mkdirSync(dirname(stateFile), { recursive: true });
      appendFileSync(stateFile, JSON.stringify({ sessionKey, turn, ts: new Date().toISOString(), status: 'ok' }) + '\n');
    } catch (e) {
      log('warn', `state.jsonl 追加失败: ${String(e).slice(0, 200)}`);
    }
    pruneState();
  }

  // ── 文本提取 ──
  /** 只认「真人 user 消息」：系统提醒/技能目录/运行上下文等合成消息一律不认。 */
  function isRealUserMessage(ev) {
    if (!ev || ev.type !== 'user/message') return false;
    const data = ev.data;
    if (!data || typeof data !== 'object') return false;
    const source = data.source;
    if (source != null && typeof source === 'object' && source.kind !== 'user') return false;
    return textOfContent(data.content).trim().length > 0;
  }

  function textOfContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    const parts = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
      else if (block.type === 'tool-result' && Array.isArray(block.content)) {
        const inner = textOfContent(block.content);
        if (inner) parts.push('[工具结果] ' + inner.slice(0, 500));
      }
    }
    return parts.join('\n');
  }

  function extractTurnTexts(session) {
    const events = session?.events;
    let userText = '';
    let assistantText = '';
    if (!Array.isArray(events)) return { userText, assistantText };
    // 从尾部往前：assistant 取最后一条文本；user 只取最后一条真人消息
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (!ev || typeof ev !== 'object') continue;
      const data = ev.data;
      if (!data || typeof data !== 'object') continue;
      if (ev.type === 'assistant/message' && !assistantText) {
        assistantText = textOfContent(data.message?.content ?? data.content);
      } else if (ev.type === 'user/message' && !userText && isRealUserMessage(ev)) {
        userText = textOfContent(data.content);
      }
      if (userText && assistantText) break;
    }
    return {
      userText: userText.slice(0, config.maxTextLen),
      assistantText: assistantText.slice(0, config.maxTextLen),
    };
  }

  // ── 写记忆库（POST /v3/conversation/add）──
  // 坑：旧版走 /capture，客户端（会话列表/记忆视图）不展示该通道写入的 L0；
  // /v3/conversation/add 可见。v2.1 起统一走 v3 通道。
  async function captureToTdai(userText, assistantText, sessionKey) {
    const body = {
      team_id: config.teamId,
      agent_id: config.agentId,
      user_id: config.userId,
      session: sessionKey,
      messages: [
        { role: 'user', content: userText },
        { role: 'assistant', content: assistantText },
      ],
    };
    try {
      const res = await fetch(config.gateway + '/v3/conversation/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + adminKey,
          'x-tdai-service-id': 'default',
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        log('error', `capture HTTP ${res.status}: ${text.slice(0, 200)}`);
        return false;
      }
      try {
        const j = JSON.parse(text);
        const accepted = j?.data?.accepted_ids;
        if (Array.isArray(accepted)) {
          log('ok', `capture OK accepted=${accepted.length} session=${sessionKey}`);
          return true;
        }
        if (j && j.l0_recorded !== undefined) {
          log('ok', `capture OK l0=${j.l0_recorded} session=${sessionKey}`);
          return true;
        }
        log('warn', `capture 响应异常: ${text.slice(0, 200)}`);
        return false;
      } catch {
        log('warn', `capture 非 JSON 响应: ${text.slice(0, 200)}`);
        return false;
      }
    } catch (e) {
      log('error', `capture 请求失败: ${String(e).slice(0, 200)}`);
      return false;
    }
  }

  async function processTurn(session, turn, reason) {
    const sessionKey = 'dsh-' + (session?.id ?? 'unknown');
    if (written.get(sessionKey)?.has(turn)) return;
    if (pending.get(sessionKey)?.turn === turn) return;
    if (session?.header?.origin === 'subagent') return;
    if (reason?.kind !== 'completed') return;
    const { userText, assistantText } = extractTurnTexts(session);
    if (!userText && !assistantText) {
      log('debug', `turn ${turn} 无文本内容（session=${sessionKey}），记账跳过`);
      markWritten(sessionKey, turn);
      return;
    }
    const ok = await captureToTdai(userText, assistantText, sessionKey);
    if (ok) {
      markWritten(sessionKey, turn);
      log('ok', `已写 TDAI agent=${config.agentId} session=${sessionKey} turn=${turn}`);
      pending.delete(sessionKey);
    } else {
      const rec = pending.get(sessionKey) || { turn, userText, assistantText, attempts: 0 };
      rec.turn = turn; rec.userText = userText; rec.assistantText = assistantText; rec.attempts += 1;
      pending.set(sessionKey, rec);
      log('error', `写入失败待重试 agent=${config.agentId} session=${sessionKey} turn=${turn} attempts=${rec.attempts}`);
    }
  }

  async function drainPending(sessionKey) {
    const rec = pending.get(sessionKey);
    if (!rec || rec.attempts > config.maxRetries) return;
    const ok = await captureToTdai(rec.userText, rec.assistantText, sessionKey);
    if (ok) {
      markWritten(sessionKey, rec.turn);
      log('ok', `补写成功 agent=${config.agentId} session=${sessionKey} turn=${rec.turn}`);
      pending.delete(sessionKey);
    } else {
      rec.attempts += 1;
      log('error', `补写失败 session=${sessionKey} turn=${rec.turn} attempts=${rec.attempts}`);
    }
  }

  // ── 事件挂接（ctx.effect 卸载自动清理）──
  /** 进行中的写入（sessionKey → Promise）：同 session 串行 + 合并最新回合，flush 时等待。 */
  const inflight = new Map();
  /** 写入进行中又来了新回合：记下最新一回合，写完当前后再补跑（防止漏写）。 */
  const recheck = new Map();

  function scheduleTurn(session, turn, reason) {
    const sessionKey = 'dsh-' + (session?.id ?? 'unknown');
    if (inflight.has(sessionKey)) {
      recheck.set(sessionKey, { session, turn, reason });
      return;
    }
    const p = processTurn(session, turn, reason)
      .catch((e) => log('error', `processTurn 异常: ${String(e).slice(0, 200)}`))
      .finally(() => {
        inflight.delete(sessionKey);
        const next = recheck.get(sessionKey);
        if (next) {
          recheck.delete(sessionKey);
          scheduleTurn(next.session, next.turn, next.reason);
        }
      });
    inflight.set(sessionKey, p);
  }

  /** 等待该会话写入链落定（含 recheck 补跑），最多 10 轮。 */
  async function waitQuiescent(sessionKey) {
    for (let i = 0; i < 10; i += 1) {
      const p = inflight.get(sessionKey);
      if (!p) return;
      await p.catch(() => {});
    }
  }

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return;
    const turn = event?.data?.turn;
    const reason = event?.data?.reason;
    if (turn === undefined) return;
    scheduleTurn(session, turn, reason); // 回合结束即写（非阻塞，但 flush 会等它）
  }));

  // flush：页面/headless 收尾时同步等待 in-flight + 补写 pending（await 语义，避免退出即丢）
  ctx.effect(() => ctx.on('session/flush', (session) => {
    const sessionKey = session && session.id ? 'dsh-' + session.id : null;
    if (!sessionKey) return;
    const jobs = [waitQuiescent(sessionKey)];
    if (pending.has(sessionKey)) jobs.push(drainPending(sessionKey));
    return Promise.all(jobs).catch((e) => log('error', `flush 收尾异常: ${String(e).slice(0, 200)}`));
  }));

  ctx.logger?.info?.(`[${name}] TDAI 自动写入 v2 已启动（gateway=${config.gateway} agent=${config.agentId} log=${logFile}）`);
}
