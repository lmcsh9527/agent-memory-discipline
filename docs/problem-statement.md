# Long-session agents stop executing their rules (~30% in) and don't query their memory at the critical moment — is there prior work on *forced* retrieval hooks?

> Date: 2026-08-20 · Status: open for feedback · License: MIT
> This is the public problem statement of the **Agent Memory & Discipline System** project (M1).

## TL;DR

We run a multi-agent desktop assistant in production-like daily use. We observe two concrete failure modes that survive every "memory system" and "rules file" we have tried:

1. **Rule-execution decay**: soft, text-based rules (startup scripts, operating guidelines, AGENTS.md-style files) are followed reliably for roughly the first 30% of a long session, then execution drops to near zero.
2. **Available-but-not-retrieved memory**: we maintain a distilled knowledge/memory store, yet at the exact moment a known pitfall matters (e.g., a deployment step that previously failed), the agent does not query it — not because retrieval fails, but because **no retrieval is triggered**.

Existing memory plugins are all *passive libraries*: the model queries them only if it happens to decide to. We believe the missing piece is a **forced retrieval access point** — a hard mechanism that makes a lookup of the known-issues store mandatory before critical actions. We're posting early to ask: has this been done? Is there prior art, research, or a product that combines interception hooks / permission gates with *mandatory knowledge retrieval*?

## 1. The problem

LLM agents in long-horizon work have three intertwined failure modes:

- **A. Memory decay** — early instructions get diluted as context grows (related to *Lost in the Middle*, but observed as *behavioral* decay, not just attention).
- **B. Rule-execution decay** — "knows the rule" ≠ "executes the rule". Text constraints degrade and eventually stop firing.
- **C. Pitfall reuse failure** — past mistakes are not surfaced before the same action is retried, so the agent re-walks known traps (trial-and-error loops).

We treat this as an open engineering problem. Our own deployment gives us unusually long, real sessions to measure it.

## 2. Empirical evidence (from our own deployment)

Environment: a desktop-based multi-agent assistant (internal codename "DSH") where a general-manager session orchestrates department sessions; sessions routinely reach hundreds of thousands of tokens; there is a plugin ecosystem including 30+ memory plugins.

Observed, measured:

1. **Startup-discipline decay.** A mandatory startup script (memory recall + rule injection) ran correctly in the first ~30% of sessions, then execution dropped to 80–100% non-execution. Soft text-rule shelf life ≈ the first 30% of a session.
2. **"Knows but doesn't do" at the moment of need.** During a plugin-installation task, the agent spent 40+ minutes in trial-and-error: four different placements for a dependency, guessed ports, hit permission (EPERM) and cache-loader pitfalls — instead of first consulting existing mechanism docs / a known-issues store. This was the same agent whose rules *explicitly* required checking before acting.
3. **Memory drift despite an existing memory store.** Infrastructure facts (container locations, service ports) were present in the distilled memory store but were not recalled at use time. Not a retrieval-quality failure — a **trigger failure**: the lookup never fired.

Common root cause: **soft constraints (text rules) decay in long contexts, and all knowledge stores are passive.** The model "knows" both the rule and the store's existence, but neither is forced at the decision point.

## 3. What exists today (our current map)

**Academic:**
- *Lost in the Middle* (Liu et al., 2023) — attention degrades for middle content; architecture-level, mitigation only.
- *MemGPT / Letta* (arXiv:2310.08560) — OS-style hierarchical memory; *Zep/Graphiti* (arXiv:2501.13956) — temporal knowledge graphs.
- *Reflexion* (NeurIPS 2023) / *Self-Refine* — verbal RL and self-feedback loops; strong on "learn from failure" but rely on the model choosing to reflect at the right time.

**Industry:**
- Anthropic Claude Code — CLAUDE.md (static rules) + Hooks (command-level interception) + Subagents (context isolation).
- OpenAI Codex — AGENTS.md + sandbox (hard permission gate).
- Devin — knowledge layer with human confirmation; executor sees only current step + working memory + plan.
- OpenAI Agents SDK — two-stage memory generation (extract → consolidate), progressive disclosure, auditable memory files.
- Agent/memory plugin ecosystems (LangChain, desktop agent stores, etc.) — 30+ memory plugins; "passive library" pattern dominates; no unified winner.

Common pattern in all of the above: **the store is queried only if the model decides to query it.** Interception (hooks) and permission gates exist, but we have not found them wired to *mandatory knowledge retrieval*.

## 4. The gap we believe is open

1. **Almost everything targets coding scenarios.** General work scenarios — creative production, multi-agent collaboration, long-conversation discipline, deployment/ops — are underserved.
2. **Forced retrieval access point is missing.** No hard mechanism that mandates a known-issues-store lookup *before* a critical action. This is, in our reading, the root cause of "having a library but not using it": availability ≠ retrieval.

We call the design direction **"interception is retrieval"** — when a permission gate or repetition guarder fires, the approval prompt should carry a mandatory "query the pitfall store" step, and the result should feed the decision.

## 5. Questions for the community

1. **Forced retrieval at decision points** — Is there prior work (research, library, product) on mandatory retrieval hooks before high-risk actions? We know command hooks (Claude Code) and permission gates (Codex sandbox) exist separately; has anyone combined them with compulsory knowledge lookup, e.g., "blocked action → auto-query known-issues store → present hits with the approval prompt"?
2. **Rule-execution survival** — Beyond prompt text, what mechanisms have been shown to keep rule execution alive past 100k-token sessions? (periodic re-injection? subagent isolation? hard gates? behavioral checkpoints?) What actually works in production, with numbers?
3. **Metrics for discipline decay** — Are there existing benchmarks/metrics for "rule-execution decay over session length" or "retrieval triggered at the right moment" (as opposed to retrieval quality like recall@k)?
4. **Non-coding long-horizon agents** — For creative / multi-agent / ops workflows that run for days, what keeps agents on-script? Any practices beyond coding-oriented scaffolding?

## 6. Our tentative direction

Three-layer architecture:

```
Execution layer (hard bottom):  permission gates + repetition guarder + ★forced retrieval hooks
Injection layer (freshness):    rule re-injection (AGENTS.md-style) + premise guard + session-rotation discipline
Memory layer (root cause):      distilled L0-L3 store + graded search + ★"pitfall knowledge base"
                                 (symptom → root cause → fix → search keywords)
```

- **MVP**: a pitfall KB with ≥10 structured entries (we already have real ones: pnpm EPERM, plugin loader cache, permission sandbox traps) + forced retrieval at session start and before high-risk operations + measurable hit rate.
- **Success metric**: next deployment-like task goes from 40 minutes of trial-and-error to <5 minutes on the right path (query → locate pitfall → fix directly).

We plan to open-source the final design (as a plugin / standalone project). This early post is to validate the problem framing and to find prior art before we over-design.

## 7. Why we're asking early

Before designing, we want to avoid reinventing:

- If "interception-is-retrieval" already exists, we want to adopt/extend it.
- If rule-execution decay has known cures with measurements, we want them in M2 design.
- If there are benchmarks for discipline decay, we want to use them instead of inventing our own.

Any pointers — papers, repos, blog posts, product internals, or "we tried X and it failed because Y" — are highly welcome.

## Appendix: environment context (for responders)

- Multi-agent desktop assistant: a "general manager" session orchestrates department sessions via shared task queues and memory; sessions persist for weeks and reach hundreds of thousands of tokens.
- Memory stack: tiered distillation (L0 raw → L3 high-level), graded keyword recall, startup recall script — the recall path works when invoked.
- Governance stack: permission gate (approval for repeated/high-risk operations), repetition guarder (interrupts after thresholds), sandboxed shell execution.
- What we lack: a pitfall KB and any *forced* lookup wiring into the gates above.

## Feedback

Please open a GitHub Discussion or Issue in this repo. All pointers and "we tried X and it failed" stories are appreciated.
