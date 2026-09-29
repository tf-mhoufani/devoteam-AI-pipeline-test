# Devoteam AI pipeline

Technical test: read infra logs (`data/rapport.json`), write a structured report (`report/output.json`) with insights, detected anomalies, and DevOps recommendations.

Metrics and anomalies are computed in deterministic TypeScript. Groq only suggests corrective actions, constrained by a strict output schema.

## Contents

- [Quick start](#quick-start)
- [Pipeline](#pipeline)
- [Middlewares](#middlewares)
- [Groq](#groq)
- [Repo structure](#repo-structure)
- [Architecture details](docs/architecture.md)

---

## Quick start

**Requirements:** Node.js 20+, [Groq](https://console.groq.com/) API key (`GROQ_API_KEY`).

```bash
npm install
```

Create a `.env` at the project root (do not commit it):

```env
GROQ_API_KEY=gsk_...
GROQ_MODEL=openai/gpt-oss-20b
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_BATCH_PAUSE_MS=2000
GROQ_MAX_RETRIES=3
```

```bash
npm start          # run the pipeline on sample data
npm run check      # typecheck + lint + tests with coverage (85% on src/)
```

| Option / env                      | Default                | Purpose       |
| --------------------------------- | ---------------------- | ------------- |
| `-i` / `--input` / `INPUT_LOGS`   | `./data/rapport.json`  | input logs    |
| `-o` / `--output` / `OUTPUT_JSON` | `./report/output.json` | output report |

Equivalent to:

```bash
npm run analyze:infra-log -- --input ./data/rapport.json --output ./report/output.json
```

Files in `report/` are gitignored (created automatically on write).

---

## Pipeline

```
data/rapport.json
        │
        ▼
  infraLogAnalyzer (CLI)
        │
        ▼
  pipe(PartialAnalysisReport)
        │
        ├─ aggregateInsights       (deterministic)
        ├─ detectAnomalies         (deterministic)
        ├─ correlateAnomalies      (deterministic)
        └─ generateRecommendations (Groq)
        │
        ▼
  writeJson + OutputSchema → report/output.json
```

---

## Middlewares

| Middleware                  | Role                                      | AI? |
| --------------------------- | ----------------------------------------- | --- |
| `aggregateInsights`         | Window averages, maxes, service status    | No  |
| `detectAnomalies`           | Threshold-based spike detection (6 metrics)| No  |
| `correlateAnomalies`        | Link related spikes into incident clusters | No  |
| `generateRecommendations`   | DevOps recommendations via Groq           | Yes |

All middlewares share `(state, ctx)` with `ctx = { logs, logger }`.  
`incident_clusters` is internal pipeline state — not written to `output.json`.  
The full anomaly list (303 peaks on sample data) is always preserved in the output.

→ [Middleware details, thresholds, diagrams](docs/architecture.md#middlewares)

---

## Groq

- **Model:** `openai/gpt-oss-20b` with strict JSON schema (Zod → Groq → `safeParse`)
- **Two passes:** draft calls per cluster / metric group / service status, then one synthesis call
- **Synthesis:** at most **one recommendation per target**, ranked offline → degraded → metrics
- **Resilience:** sequential calls with pause, independent 429 and 400 retry budgets, `failed_generation` recovery
- **Prompts:** four scoped system prompts (metric, cluster, status, synthesis) — see [prompt design](docs/architecture.md#prompt-design)

Typical sample output: ~3 recommendations instead of hundreds of near-duplicates.

---

## Repo structure

| Folder                            | Role                               |
| --------------------------------- | ---------------------------------- |
| `src/scripts/infraLogAnalyzer.ts` | CLI orchestrator                   |
| `src/middlewares/*`               | one pipeline step per folder       |
| `src/services/groq`               | reusable Groq client               |
| `src/helpers/*`                   | shared utilities                   |
| `src/types/`                      | Zod schemas + `PipelineContext`    |
| `src/test/fixtures.ts`            | shared test helpers                |
| `docs/architecture.md`            | detailed design notes              |
| `data/`                           | input logs                         |
| `report/`                         | generated output (gitignored)      |
