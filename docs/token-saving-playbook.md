# Token-Saving Playbook: Slim Memory + On-Demand Recall + Compaction Synergy

> M4 output · 2026-08-21 · Public version (implementation-specific paths redacted)
> Solves problem class **D: cost runaway (full injection vs on-demand recall)** from the [problem statement](problem-statement.md).
> Companion design: [forced-retrieval-design.md](forced-retrieval-design.md) (interception is retrieval).

## TL;DR

1. **Fixed per-round injections should be index-level only.** Local memory files carry high-frequency rules and a persona card; everything else moves to a reversible archive plus a searchable store. Measured: **5.1 KB → 3.3 KB per round (-35%)**.
2. **Replace "inject everything" with "recall on demand."** Hook the message-assembly point to search the memory store per real user message and inject a small, bounded digest. Retrieval failure degrades silently — it must never break the session.
3. **Compaction can be tightened once everything is retrievable.** Trigger earlier, keep slightly less raw tail, but *increase* the summary budget. Guard it with an anchor-loss alerter so dropped literals are surfaced instead of silently lost.
4. **Every layer is reversible and measured.** Acceptance includes an "amnesia test": after compaction, a verbatim detail from compacted-away history must be recoverable via search.

## Why: the cost structure of an agent session

| Cost layer | Before | After |
|---|---|---|
| Per-round fixed (memory files) | everything injected, grows forever | index-level only, archived rest |
| Per-message | nothing (or full dumps) | bounded on-demand digest |
| Conversation-level | conservative compaction, late trigger | earlier trigger + richer summary |
| Recovery path | none (compacted = gone) | searchable store + anchor-loss guard |

## Layer 1 — Slim local memory (fixed cost)

- **Keep in the always-injected file**: high-frequency iron rules, persona card, pointers. Index-level, not knowledge-level.
- **Move out**: low-frequency details → (a) an archive file (one command to restore), (b) the searchable memory store.
- **Numbers from our run**: main memory file 41 lines → 12 entries; user file → 6-line persona card; combined injection 5.1 KB → 3.3 KB per round.
- **Rule**: slimming must be reversible. Archive before delete; snapshot the directory (git or backup) first.

## Layer 2 — On-demand recall (per-message cost)

A small hook at the session assembly point:

```
trigger : once per turn, before the first tool call
query   : last real user text (skip if < ~8 chars)
lookup  : search memory entries + past conversations (two endpoints)
budget  : ≤600 chars total, formatted as bullet digest
limits  : 2s timeout, 30s result cache, silent no-op on any failure
```

Design properties that matter:

- **Bounded**: the injection has a hard size cap; it cannot grow into the next full-injection problem.
- **Silent degrade**: network down / store down ⇒ inject nothing, session continues.
- **Message-driven**: the query is the user's actual words, so hits are relevant by construction.

## Layer 3 — Compaction synergy (conversation-level cost)

Conservative defaults (trigger at 80% context, keep 16% raw tail, 8K summary) exist because compaction historically meant *loss*. Once two preconditions hold, they can be relaxed:

1. **Every conversation is captured to a searchable store** (write channel verified end-to-end).
2. **An anchor-loss guard is active**: after each compaction, scan the summary for dropped literal anchors (paths, values, error codes, URLs) and surface a one-shot notice telling the model what may have been lost and how to read it back.

Then tighten along the safe axis:

| Knob | Default | Tightened | Rationale |
|---|---|---|---|
| trigger ratio | 0.8 | 0.6 | compact earlier while detail is still cheap to summarize |
| retained tail | 0.16 | 0.15 | marginal; recent context stays intact |
| summary budget | 8K | 20K | **increase** — richer summaries are the safe direction |

Revert path: remove one config override block, restart. Nothing deleted, everything re-derivable.

## Verification protocol

- **Amnesia test (acceptance)**: after a real compaction, ask the agent for a verbatim quote from compacted-away history. It must answer correctly *via live search*, not from residual context. Our run: hit on first try.
- **Guard alert check**: the anchor-loss guard fired on the first real compaction and listed exactly what was dropped; assessment showed all items were historical, already stored elsewhere.
- **Token accounting**: compare fixed per-round bytes before/after; observe several days for end-to-end savings before further tightening.

## Porting notes

The pattern needs four primitives, any stack that has them can adopt it:

| Primitive | Our implementation | Generic equivalents |
|---|---|---|
| searchable conversation/memory store | local memory service with HTTP search API | MCP memory servers, vector DBs, `CLAUDE.md` + grep |
| assembly hook point | preset bootstrap hook (once per turn) | Claude Code hooks, middleware in your agent loop |
| compaction config surface | plugin config override | built-in compaction settings, custom summarizer |
| anchor-loss guard | post-compaction drift guard plugin | checklist diff, log-recovery notice |

## Scope boundaries (what we deliberately did not do)

- Model routing / provider selection — separate workstream, orthogonal to this playbook.
- System-prompt and tool-schema slimming — platform-level change, low certainty ROI; revisit later.
- Further tightening beyond the numbers above — wait for multi-day token data first.
