# Examples: Token-Saving Components

Working reference implementations behind the [token-saving playbook](../../docs/token-saving-playbook.md).
Extracted from our production setup on 2026-08-21; identifiers, key paths and internal
directories are redacted — configure your own via the marked spots.

| Component | Playbook layer | What it does |
|---|---|---|
| [`dsh-tdai-capture/`](dsh-tdai-capture/) | conversation capture (precondition for Layer 3) | DSH plugin: writes every real user/assistant turn to the memory service (`POST /v3/conversation/add`), with persistent dedup, retry-on-failure, flush-time await |
| [`on-demand-recall-hook.sample.mjs`](on-demand-recall-hook.sample.mjs) | Layer 2 (per-message recall) | assembly-point hook: search memories + past conversations per real user message, inject a ≤600-char digest; 2s timeout, 30s cache, silent degrade |

## Redaction applied

- team / agent / user IDs → empty defaults or `process.env`
- admin-key file path → `TDAI_ADMIN_KEY_FILE` env var
- internal absolute paths removed

## Notes

- The capture plugin targets the DSH plugin API (`ctx.effect`, `session/event`, `session/flush`);
  port the *behavior* (real-user filter, dedup ledger, flush await) rather than the exact API.
- The memory service endpoints used: `/v3/conversation/add` (write),
  `/search/memories` + `/search/conversations` (read). Any store with equivalent semantics works.
