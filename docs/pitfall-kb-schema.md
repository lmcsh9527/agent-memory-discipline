# Pitfall Knowledge Base — Schema v0.1

> M2 design draft (M1 output ③) · 2026-08-20 · Public version
> Aligns with LongMemEval-V2 "environment gotchas" and Voyager-style executable skills.

## Goal

Make a known-issues store that a **forced retrieval hook** (see `forced-retrieval-design.md`) can hit reliably: fast local matching, executable fixes, verified-only for hard gates, human-gated writes.

## Entry Schema (YAML)

```yaml
id: "PB-001"                # unique id
title: "pnpm install fails with EPERM"   # one-line title (shown on hit)
status: active              # active | deprecated | merged
domain: "plugin-install"    # domain category
severity: high              # high | medium | low

# --- retrieval side ---
symptom:                    # trigger patterns (exact/partial match)
  - "pnpm install reports EPERM: operation not permitted"
  - "plugin install cannot write to profiles directory"
keywords:                   # aliases / synonyms / mixed-language terms
  - pnpm
  - EPERM
  - plugin install
  - sandbox write permission

# --- knowledge side ---
root_cause: "installer invoked pnpm through a sandboxed shell that denied profile-dir writes; switching to direct child-process execution fixed it"
fix:
  verified: true            # only verified entries enter L0 forced retrieval
  steps:
    - "check pnpm version matches the version declared by the project"
    - "ensure installer runs pnpm via direct process spawn, not sandboxed shell"
    - "ensure npm store dir is writable"
  verify_command: "pnpm install --dry-run"
premise:                    # environment applicability (premise awareness)
  - "desktop agent harness, profile=web"

# --- governance ---
ref: "incident log 2026-08-19"   # traceability
author: "ops engineer"
reviewer: "project office"       # human gate
created_at: "2026-08-20"
updated_at: "2026-08-20"
hit_count: 0                # forced-retrieval hits (KPI)
last_hit_at: null
resolve_rate: null          # share of hits that led to a resolved attempt
```

## Design Decisions

| Decision | Rationale |
|---|---|
| Three retrieval channels: symptom full-text + keywords + (optional) vector | fast local match; works from raw command text at interception time |
| `fix.steps` executable + `verified` flag | only `verified: true` entries surface in L0 forced gates (prevents misleading); enables future auto-execution |
| `premise` field | LME-V2 premise awareness — filter out entries for the wrong environment |
| Human-gated writes (`reviewer`) | memory pollution prevention; automated extraction only produces *candidates* |
| `hit_count` / `resolve_rate` KPIs | pitfall hit rate measured directly from the store |
| `deprecated` / `merged` status | pitfalls become stale (e.g. fixed upstream); entries must be able to retire |

## Domain Categories (initial)

`plugin-install` · `profile` · `infrastructure` · `memory` · `permission` · `model` · `workflow`

## Write Flow

```
incident → memory system auto-logs (candidate trace)
   → weekly review extracts candidate entries
   → human confirms (reviewer field)
   → entry lands in store, verified=false
   → validated in real environment → verified=true (eligible for L0)
```

## Validation

- JSON Schema: required `id/title/symptom/root_cause/fix.steps/keywords`; `verified` boolean; `status` enum.
- Load-time validation: skip + alert on malformed entries.
- Dedup: unique `id`; similarity check on title/symptom before write.

## Interface Contract (with forced-retrieval design)

- `query(q, env) -> topN entries with score`
  - `q`: query extracted at the interception point (raw command + context keywords)
  - `env`: premise filter (profile / domain / branch)
  - returns top-3 for L0 presentation
- `record_hit(id, resolved) -> updates hit_count / resolve_rate`
