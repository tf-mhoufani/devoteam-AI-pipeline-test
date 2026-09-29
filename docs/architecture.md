# Architecture

Detailed design notes for the Devoteam AI pipeline. For setup and commands, see the [README](../README.md).

## Contents

- [Technical choices](#technical-choices)
- [Pipeline overview](#pipeline-overview)
- [Middlewares](#middlewares)
- [Groq integration](#groq-integration)
- [Prompt design](#prompt-design)
- [Repo structure](#repo-structure)
- [Future directions](#future-directions)

---

## Technical choices

Linear middleware flow instead of LangGraph: load → aggregate → detect → correlate → recommend → write. Testable steps with `pipe()`, strategy pattern for insights/anomalies, shared `PipelineContext`, injectable logger.


| Choice                | Why                                                                              |
| --------------------- | -------------------------------------------------------------------------------- |
| **TypeScript 6**      | Typed pipeline, `#` aliases, `tsc --noEmit`, no JS build                         |
| **Zod 4**             | Input/output validation, Groq JSON Schema, inferred types                        |
| **tsx**               | Run CLI with `--env-file=.env`                                                   |
| **OpenAI SDK**        | Groq entry point; custom 429/400 handling in `services/groq`                     |
| **Vitest**            | ESM-native tests, Groq mocks, 85% coverage threshold on `src/` (`npm run check`) |
| **ESLint + Prettier** | Lint + formatting                                                                |


---

## Pipeline overview

The pipeline builds a shared `PartialAnalysisReport` step by step. Each middleware reads the state, adds its fields, and passes it on. Every middleware uses the same signature: `(state, ctx)` with `ctx = { logs, logger }`.

```
data/rapport.json
        │
        ▼
  loadJson (validate LogEntry[])
        │
        ▼
  infraLogAnalyzer — pipe(PartialAnalysisReport)
        │
        ├─ aggregateInsights       (deterministic)
        ├─ detectAnomalies         (deterministic)
        ├─ correlateAnomalies      (deterministic)
        └─ generateRecommendations (Groq)
        │
        ▼
  writeJson + OutputSchema → report/output.json
```

| Step                      | Adds to state                                       |
| ------------------------- | --------------------------------------------------- |
| `loadJson`                | raw `LogEntry[]` (passed via `ctx`, not in state)   |
| `aggregateInsights`       | `insights`, `service_status_summary`                |
| `detectAnomalies`         | `anomalies`                                         |
| `correlateAnomalies`      | `incident_clusters` (internal — not in output JSON) |
| `generateRecommendations` | `recommendations`                                   |
| `writeJson`               | full `AnalysisReport` + `timestamp`                 |


---

## Middlewares

### 1. `aggregateInsights` — window summary

Turn the full log window into global metrics and a service status snapshot. No AI.

```
LogEntry[] (all lines)
        │
        ▼
  strategy fold (INSIGHT_AGGREGATORS)
        │
        ▼
  groupServiceStatus (scan all lines)
        │
        ▼
state.insights + state.service_status_summary
```

- **Output:** `insights` (averages + maxes), `service_status_summary` (online / degraded / offline lists)
- **Does not:** flag spikes, call Groq, or drop log lines

---

### 2. `detectAnomalies` — spike detection

Scan each log line and keep only abnormal events. Fixed thresholds, not AI.


| Metric      | Medium   | High     |
| ----------- | -------- | -------- |
| CPU         | ≥ 85%    | ≥ 95%    |
| latency     | ≥ 250 ms | ≥ 350 ms |
| error rate  | —        | ≥ 0.05   |
| memory      | ≥ 85%    | ≥ 90%    |
| disk        | ≥ 85%    | ≥ 90%    |
| temperature | ≥ 80°C   | ≥ 85°C   |


New rules are one strategy in `ANOMALY_STRATEGIES` — no schema change needed.

- **Output:** full list of anomalies (303 on sample data)
- **Does not:** aggregate metrics, suggest fixes, or call Groq

---

### 3. `correlateAnomalies` — link related spikes

Group anomalies into incident clusters so Groq sees related signals, not isolated metrics. No AI.

**Why:** Without correlation, CPU + latency + error rate at the same timestamp look like three independent problems. Clusters turn them into one incident narrative (saturation, or latency causing errors). Detection stays exhaustive: `anomalies[]` remains complete in the final JSON; `incident_clusters` is internal state for Groq orchestration only.


| Type               | Rule                                                       | Example                             |
| ------------------ | ---------------------------------------------------------- | ----------------------------------- |
| `co_occurrence`    | ≥ 2 metrics abnormal on the same timestamp                 | CPU + latency + error rate at 12:00 |
| `temporal_cascade` | `latency_ms` spike then `error_rate` spike on the next log | Timeouts causing errors             |


- **Does not:** remove anomalies from the list or call Groq directly

---

### 4. `generateRecommendations` — DevOps actions (Groq)

Turn insights + anomalies + service status into a short list of actionable recommendations.

```
Pass 1 — draft calls (sequential)
  1 Groq call / incident cluster
  1 Groq call / remaining metric group
  1 Groq call for degraded + offline services
        │
        ▼
Pass 2 — synthesis (merge + rank)
        │
        ▼
state.recommendations[]
```

- **Input:** global `insights`, grouped anomaly summaries, unhealthy services, allowed targets (`database`, `api_gateway`, `cache`)
- **Output:** ranked recommendations (`REC-001`, …). If synthesis returns nothing, drafts are kept
- **Does not:** change the anomaly list or invent services outside the observed set

---

## Groq integration

### Provider and model

- **Groq** — OpenAI-compatible API via `openai` client + `GROQ_BASE_URL`
- **`openai/gpt-oss-20b`** — supports `json_schema` + `strict: true`
- **Structured outputs** — Zod builds the JSON Schema; parser uses `safeParse`

### API throttling and resilience

**Spacing:** calls run sequentially with a 2 s pause (`GROQ_BATCH_PAUSE_MS`) to stay under the free tier (8k TPM).

**429 (rate limit):** wait for `retry-after`, retry up to `GROQ_MAX_RETRIES` (default 3). Separate budget from schema errors. If 429 persists, skip the group and continue.

**400 (schema / truncated output):**

1. Recover partial JSON from `failed_generation` when parseable
2. Retry if `failed_generation` is empty or truncated
3. Skip the group if retries fail

### Two-pass workflow

**Pass 1 — drafts** (each call isolated):


| Step              | Input sent                                    | Goal                     |
| ----------------- | --------------------------------------------- | ------------------------ |
| 1 call / cluster  | Correlated incident                           | 1–2 root-cause recos     |
| 1 call / metric   | Remaining metric groups (non-clustered times) | 1–2 recos per spike type |
| 1 call for status | `degraded` / `offline` services               | 1 reco per service       |


Grouping by metric sends scale (`count: 49`) instead of 49 raw lines — fewer tokens and fewer duplicate recos.

**Pass 2 — synthesis:** merge drafts into **at most one recommendation per target**, rank offline → degraded → metrics. Typical sample output: ~3 recos instead of dozens of near-duplicates.

### Prompt design

Four dedicated system prompts (in `generateRecommendations.constants.ts`) + user payloads from `buildRecommendationPrompt.ts`:


| Prompt           | Constant                       | Purpose                                          |
| ---------------- | ------------------------------ | ------------------------------------------------ |
| Metric group     | `GROQ_SYSTEM_PROMPT`           | 1–2 recos per spike type, not per peak           |
| Incident cluster | `GROQ_CLUSTER_SYSTEM_PROMPT`   | Root-cause fix for correlated patterns           |
| Service status   | `GROQ_STATUS_SYSTEM_PROMPT`    | One reco per degraded/offline service            |
| Synthesis        | `GROQ_SYNTHESIS_SYSTEM_PROMPT` | Merge only — one reco per target, no new actions |


**Guardrails (all prompts):**

- `target` must be an observed service — listed as `Allowed targets` in the user message
- Flat `parameters` only — required for Groq strict JSON schema
- Insights are window aggregates — not live state
- Synthesis never invents — empty synthesis → keep drafts

### Groq service layer

```
generateRecommendations ──► services/groq ──► Groq API
         (prompts, grouping)     (429, retries, structured chat)
```

- **`src/services/groq`** — transport: client, pauses, retries, structured outputs
- **`src/middlewares/generateRecommendations`** — business logic: grouping, prompts, synthesis

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

---

## Future directions

- **Detection** — more metrics from `LogEntry`, richer correlation, optional baseline-based rules
- **Recommendations** — optional `CLOUD_PROVIDER` for vendor-specific wording; smarter Groq grouping
- **Operations** — structured logging, Groq latency / 429 metrics, draft cache for local re-runs
- **Performance** — today: full in-memory load, every spike in `anomalies[]`, sequential Groq. At scale: chunked/streaming input, windowed analysis, incremental metrics, anomaly summarization in the report

