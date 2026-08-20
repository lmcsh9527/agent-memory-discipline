# Forced Retrieval Access Point — Design v0.1 ("Interception is Retrieval")

> M2 design draft (M1 output ④) · 2026-08-20 · Public version
> This is the implementation blueprint for the core question in [Discussion #1](https://github.com/lmcsh9527/agent-memory-discipline/discussions/1).

## Goal

Make pitfall-KB hits **independent of model self-discipline**: when a high-risk action is intercepted (permission gate, repetition guard, session start), the system *must* query the known-issues store and present hits alongside the decision. **Interception is retrieval.**

## Access Points (priority order)

| # | Hook | Trigger | Strength | Presentation |
|---|---|---|---|---|
| A1 | Session start | new session / startup hook | **L0 forced** | inject top general pitfalls + current-domain pitfalls |
| A2 | Permission-gate approval | high-risk / repeated command intercepted | **L0 forced** | approval prompt shows "known pitfall + fix" |
| A3 | Repetition guard | same action repeated beyond threshold | **L0 forced** | interrupt + show known solutions |
| A4 | Error/exit-code hook | command exits non-zero | L1 advisory | silent injection of troubleshooting leads |
| A5 | Task dispatch | new task enqueued | L1 advisory | inject related pitfalls into task context |

L0 = mandatory (high value, low latency, verified entries only). L1 = soft (silent/advisory, non-blocking).

## Core Flow (one forced retrieval)

```
[hook fires]  permission gate / repetition guard / session start / error
      │
      ▼
[1. extract query]   raw command + operation target + context keywords → q
      │
      ▼
[2. env filter]      premise match (profile / domain / branch) → env
      │
      ▼
[3. query store]     query(q, env): symptom full-text + keywords + (vector)
      │
      ▼
[4. threshold]       score ≥ threshold AND verified=true (for L0) → top-3
      │
      ▼
[5. present/inject]  A2/A3 explicit (approval prompt); A1/A4/A5 context injection
      │
      ▼
[6. feedback loop]   record_hit(id, resolved) → hit_count / resolve_rate
```

Key point for A2: **retrieval completes before the approval prompt renders** — the result participates in the decision, it is not a post-hoc reminder.

## KPIs

| Metric | Definition | Baseline → Target |
|---|---|---|
| Forced-retrieval coverage | L0 hooks actually queried / should have queried | 0% → 100% |
| **Pitfall hit rate** | hits / queries | 0 → measured after first ≥10 entries |
| Hit resolve rate | hits that led to resolved attempt | — → ≥80% |
| Discipline decay curve | rule-execution rate vs session length | ~0 after 30% → ≥80% at end (M4 acceptance) |
| Task time / retries | deployment-like task | 40 min trial-and-error → ≤5 min |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Retrieval latency slows approval | local full-text match <50ms; L0 local-only; A4/A5 async |
| Misleading hits | verified=true required for L0; top-3 cap; confidence threshold |
| Over-interruption | A2/A3 explicit (already gated); A4/A5 silent |
| Store pollution | human-gated writes; verified tiers |
| Stale fix | deprecated status; low resolve_rate demotes/retires entry |
| Poor query extraction | three channels: raw-command full-text fallback + keywords + vector |

## MVP Path (M3, ~2 weeks)

1. Store: ≥10 verified entries + validation + `query(q, env)`.
2. A1 session-start forced retrieval (half a day).
3. A2 permission-gate pre-approval lookup (1–2 days, core).
4. A3 repetition interrupt + A4 error hook (1 day).
5. Feedback loop + acceptance run (one real deployment-like task: 40 min → ≤5 min).

## Acceptance (end of M3)

1. Deployment-like task: 40 min trial-and-error → ≤5 min on the right path.
2. L0 coverage 100%.
3. Hit-rate baseline measured.
4. Decay-curve improvement measurable after session-start injection.
