# Setup Guide

Get the token-saving loop (capture → recall → compact) running on your machine.
Two backends are supported; both speak the same three HTTP endpoints, so you can
start small and upgrade without touching client code.

| Tier | Best for | Requires | Setup |
|---|---|---|---|
| **A. memory-lite** (bundled here) | trying it out, single machine, zero external deps | Node.js ≥ 18 | ~1 min |
| **B. [TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)** (MIT) | semantic search, L1→L3 distillation, memory panel UI, auto write-back pipeline | Node ≥ 22, see upstream docs | ~10 min |

---

## Tier A: memory-lite — zero dependencies, ~1 minute

A single-file service bundled at [`lite-server/server.mjs`](lite-server/server.mjs).
No npm install. JSON-file storage, keyword search.

```bash
cd lite-server
PORT=8420 node server.mjs

# check it
curl http://127.0.0.1:8420/health
```

Optional environment variables:

```bash
PORT=8420                          # listen port (default 8420)
MEMORY_LITE_FILE=./data/memory.json  # storage path (default ./data/memory.json)
MEMORY_LITE_KEY=my-secret          # enable bearer auth if set
```

Seed a few memory entries so `/search/memories` has something to return:

```bash
curl -X POST http://127.0.0.1:8420/memories/add \
  -H 'Content-Type: application/json' \
  -d '{"type":"work_method","priority":80,"scene":"ops","body":"pnpm EPERM after core upgrade: fix peer ranges in installed manifests"}'
```

## Tier B: full TencentDB Agent Memory

Follow the upstream install guide: https://github.com/TencentCloud/TencentDB-Agent-Memory
(MIT licensed — same as this repo). You get semantic/vector search, the L0→L3
distillation pipeline, and a memory panel. Once it serves `POST /search/*` and
`POST /v3/conversation/add` (it does by default), point every client below at
its address — nothing else changes.

---

## Wire the capture plugin (conversation write channel)

`examples/token-saving/dsh-tdai-capture/` is a DSH desktop plugin. To use it:

1. Copy the folder into your plugin workspace and register it in your profile's
   `dsh.profile.bundles` list (single registration channel — avoid double paths).

2. Configure it via a profile-patch config override (entry id must match the
   loader entry id you registered):

   ```yaml
   - id: dsh-tdai-capture        # your loader entry id
     config:
       gateway: http://127.0.0.1:8420
       teamId: <your-team-id>
       agentId: <your-agent-id>
       userId: <your-user-id>
       adminKeyFile: /safe/path/.admin-key   # key lives OUTSIDE any repo
   ```

3. Restart, then verify: the plugin logs `TDAI 自动写入 v2 已启动`, and after one
   user/assistant exchange, `capture OK accepted=…` appears in its log file.

Non-DSH stacks: port the *behaviors* — real-user-message filter, persistent
dedup ledger, flush-time await, retry-with-backoff — into your own turn hook.

## Wire the on-demand recall hook (per-message injection)

`examples/token-saving/on-demand-recall-hook.sample.mjs` exports
`buildRecallSection(session)`. Call it where your stack assembles the system
prompt each turn and append the returned `{ name, order, text }` section.
Budgets (≤600 chars, 2s timeout, 30s cache, silent-fail) are constants at the
top — tune them to your taste. On non-DSH stacks (Claude Code hooks, custom
agent loops), the function body is self-contained; adapt only the
`lastRealUserText()` event-plumbing part.

## Tighten compaction (only AFTER capture works)

The playbook's Layer 3 assumes everything is recoverable from the store. Only
once capture is verified should you relax your compaction defaults along the
safe axis described in [`docs/token-saving-playbook.md`](docs/token-saving-playbook.md),
with an anchor-loss guard active.

## Acceptance: run the amnesia test

1. Chat normally for a while (capture filling the store).
2. Trigger a compaction (or wait for auto-trigger).
3. Ask the agent for a **verbatim quote** from early history.
4. Pass = it answers correctly *via live search*, not residual context.

If any step fails, revert the compaction override first — capture and recall
must be solid before tightening anything.
