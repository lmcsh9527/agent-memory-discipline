# Landscape Survey: Agent Long-Term Memory & Execution Discipline

> M1 output · 2026-08-20 · Public version (internal details redacted)
> Full report (internal): `M1-系统化调研报告-20260820.md`

## TL;DR

1. **Attention decay in long contexts is architecture-level** (Lost in the Middle, TACL 2023) — positional bias means middle-context rules get diluted. Text-only mitigation is insufficient; mechanisms are needed.
2. **"When to retrieve" is currently solved as an *internal model decision*:** Self-RAG trains reflection tokens; AutoMem (2026-07) treats memory management as a learnable skill. **No work forces retrieval externally at runtime** — our core innovation "forced retrieval access point" is confirmed as a genuine gap.
3. **LongMemEval-V2 (2026-05) already supports our direction:** it includes "environment gotchas / recurring failure modes" as a core memory capability for web agents — aligning with our "pitfall knowledge base" concept.
4. **Scenario gap confirmed:** existing work targets coding (Claude Code/Codex/Devin), games (AutoMem/Reflexion/Voyager), and web agents (LME-V2). Real-world workflows (creative production, multi-agent collaboration, ops, long-conversation discipline) are underserved.

## Academic Landscape

### Long-context attention
- **Lost in the Middle** (arXiv:2307.03172, TACL 2023): positional bias — performance highest at beginning/end, drops in the middle. Implication: early-injected rules survive longer, but middle rules dilute; text reordering helps only marginally.

### Memory architectures
- **MemGPT/Letta** (arXiv:2310.08560): OS-style hierarchical memory, recursive summarization, FIFO eviction.
- **Zep/Graphiti** (arXiv:2501.13956): temporal knowledge graph, incremental updates.
- **Generative Agents** (arXiv:2304.03442): memory stream + reflection + retrieval scoring (recency/relevance/importance).
- Common pattern: all are **passive stores** — the model queries them only if it decides to.

### Retrieval timing — "when to retrieve"
- **Self-RAG** (arXiv:2310.11511): trains reflection tokens so the model learns to retrieve on-demand — **internal model decision**.
- **AutoMem** (arXiv:2607.01224, Jul 2026): treats memory management (what to encode, *when to retrieve*, how to organize) as a trainable skill; file operations become first-class actions; 2-4x improvement on long-horizon games. **Still model-internal — no external enforcement.**
- **Key gap**: no work forces an external retrieval lookup before critical actions. "Knowing when to retrieve" (trained) ≠ "must retrieve" (runtime enforced).

### Self-evolution & experience
- **Reflexion** (NeurIPS 2023): verbal RL — failure → reflection → episodic memory → reuse.
- **Voyager** (NeurIPS 2023): skill library = executable code + description + vector index; automatic curriculum.
- **MetaGPT** (ICLR 2024): SOP + executable feedback + cross-project constraint update.
- **ChatDev** (ACL 2024): communication chain + de-hallucination via "clarify before answering."

### Benchmarks
- **LongMemEval** (arXiv:2410.10813, ICLR 2025): 5 memory abilities, 500 questions, 30% accuracy drop for commercial assistants in long contexts.
- **LongMemEval-V2** (arXiv:2605.12493, May 2026): web agent environment experience — **includes "environment gotchas / recurring failure modes"** as a core ability. 451 questions, 500 trajectories (115M tokens). AgentRunbook-R/C method.
- **No benchmark for discipline decay or retrieval-trigger correctness** — our own decay curve measurements are a unique data point.

## Industry Landscape

| Product | Hard gates | Knowledge retrieval | Retrieval forced? |
|---|---|---|---|
| Claude Code | CLAUDE.md + Hooks (PreToolUse/PostToolUse) | Passive | No |
| OpenAI Codex | AGENTS.md + Sandbox (permission gate) | Passive | No |
| OpenAI Agents SDK | — | Two-stage memory (extract→consolidate) | No |
| Devin | Knowledge layer (human-confirmed write) | Executor sees only current step | No |
| Mem0 | — | User/session/agent granularity, vector+graph | No |
| Zep/Graphiti | — | Temporal knowledge graph | No |

**Common pattern**: interception (hooks) and permission gates exist, but **no product wires them to mandatory knowledge retrieval**. The "blocked action → auto-query pitfall store → present hits" flow is unimplemented.

## Gap Confirmation

1. **Forced retrieval access point**: no prior art. All retrieval-timing work is model-internal; all interception work is permission-based, not knowledge-based.
2. **Non-coding long-horizon scenarios**: underserved by existing solutions.
3. **Discipline decay metrics**: no benchmark. Our measured decay curve (80-100% non-execution after ~30% of session) is a first data point.

## Design Implications

Our three-layer architecture maps to the landscape:

- **Execution layer**: borrow Claude Hooks (interception timing) + Codex Sandbox (hard gates); **add forced retrieval**: gate fires → query pitfall KB → present hits with approval prompt.
- **Injection layer**: borrow CLAUDE.md/AGENTS.md (rule files) + AutoMem (structure auto-improvement) + MetaGPT (cross-session constraint update).
- **Memory layer**: borrow LME-V2 gotchas (structured pitfall entries) + Voyager (executable skills) + MemGPT (tiering).
- **Evaluation**: LongMemEval's three-stage framework + our decay curve + pitfall hit rate.

## Key References

1. Lost in the Middle — arXiv:2307.03172 (TACL 2023)
2. Self-RAG — arXiv:2310.11511
3. AutoMem — arXiv:2607.01224 (2026-07)
4. LongMemEval — arXiv:2410.10813 (ICLR 2025)
5. LongMemEval-V2 — arXiv:2605.12493 (2026-05)
6. Regimes — arXiv:2606.10241 (2026-06)
7. MemGPT — arXiv:2310.08560; Zep/Graphiti — arXiv:2501.13956
8. Reflexion — arXiv:2303.11366; Voyager — arXiv:2305.16291
9. MetaGPT — arXiv:2308.00352; ChatDev — arXiv:2307.07924
10. Claude Code (docs.anthropic.com); OpenAI Codex; OpenAI Agents SDK; Devin; Mem0 (mem0.ai)