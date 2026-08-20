# Roadmap

> Agent Memory & Discipline System — public milestones. Status updated as work progresses.

## M1 — Problem definition & landscape (current)

- [x] Internal problem statement & empirical evidence
- [x] Public problem statement (this repo, English + Chinese summary)
- [ ] Landscape survey (academic + industry) consolidated into a doc
- [ ] Community feedback round (Discussion/Issues)

## M2 — Design

- [ ] Pitfall knowledge base schema (`symptom → root cause → fix → search keywords`)
- [ ] Forced retrieval access point design (permission-gate integration, repetition-triggered retrieval)
- [ ] Integration notes with the tiered memory stack (L0–L3)

## M3 — MVP experiment (target: 2 weeks)

- [ ] ≥10 structured pitfall entries (real ones: pnpm EPERM, plugin loader cache, sandbox permission traps)
- [ ] Forced retrieval at session start + before high-risk operations
- [ ] Real deployment-task validation — goal: 40 min trial-and-error → <5 min right path

## M4 — Validation & release

- [ ] Metrics review: rule-execution decay curve, pitfall hit rate, task time/retries, token cost
- [ ] Generalize and publish as a plugin / standalone project
