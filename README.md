# Agent Memory & Discipline System

> Open problem statement + design work for keeping LLM agents disciplined across long sessions.
>
> **Status: M3 validated on real tasks — M4 (metrics review & release) in progress.**

## The problem in one sentence

LLM agents in long sessions degrade in two ways: they **stop executing soft text rules** (~30% into a session, in our measurements), and they **don't query their memory store at the moment a known pitfall matters** — *availability ≠ retrieval*.

## Why this repo exists

We run a multi-agent desktop assistant in daily production use and measured both failure modes. Before designing our own solution, we are posting the problem publicly to find prior art and feedback. The repo will later hold the design (pitfall-KB schema, forced-retrieval hooks) and an MVP.

## Repo layout

- `docs/problem-statement.md` — full public problem statement + questions for the community (English)
- `docs/problem-statement-zh.md` — Chinese summary
- `docs/landscape-survey.md` — academic + industry landscape, gap confirmation (M1)
- `docs/pitfall-kb-schema.md` — schema for the structured known-issues store (M2)
- `docs/forced-retrieval-design.md` — "interception is retrieval" hook design (M2)
- `docs/token-saving-playbook.md` — slim memory + on-demand recall + compaction synergy, with measured numbers (M4)
- `docs/roadmap.md` — M1–M4 milestones

## Key concepts

- **Rule-execution decay** — soft text rules are followed early in a session, then stop firing.
- **Available-but-not-retrieved memory** — the store exists; the lookup never triggers at the decision point.
- **Forced retrieval access point** ("interception is retrieval") — a hard mechanism that makes a lookup of the known-issues store mandatory before high-risk actions.

## Questions for the community

See [`docs/problem-statement.md`](docs/problem-statement.md). We are specifically looking for:

1. Prior work on **forced retrieval at decision points** (interception + mandatory lookup).
2. Mechanisms that keep **rule execution alive past 100k-token sessions**, with measurements.
3. **Metrics/benchmarks for discipline decay** and retrieval-trigger correctness.
4. Practices for **non-coding long-horizon agents** (creative, multi-agent, ops) staying on-script.

## Roadmap

| Milestone | Focus | Status |
|---|---|---|
| M1 | Problem definition & landscape | ✅ 2026-08-20 |
| M2 | Design: pitfall KB schema + forced retrieval hook interaction | ✅ 2026-08-20 |
| M3 | MVP: real-task validation | ✅ 2026-08-20 (repeated-failure task 40 min → 10 min) |
| M4 | Metrics review & release (plugin / standalone) | 🚧 in progress |

## License

[MIT](LICENSE)
