# Devoteam AI pipeline

Technical test: read infra logs (`data/rapport.json`), write a structured report (`report/output.json`) with insights, detected anomalies, and DevOps recommendations.

Metrics and anomalies are computed in deterministic code. Groq only suggests corrective actions, in the expected output schema.

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
npm start
# same as:
npm run analyze-logs -- --input ./data/rapport.json --output ./report/output.json
npm test
```


| Option / env                      | Default                | Purpose        |
| --------------------------------- | ---------------------- | -------------- |
| `-i` / `--input` / `INPUT_LOGS`   | `./data/rapport.json`  | input logs     |
| `-o` / `--output` / `OUTPUT_JSON` | `./report/output.json` | output report  |


Files in `report/` are gitignored.

## Pipeline

```
data/rapport.json
        │
        ▼
  logAnalyzer (CLI) — loadJson + Zod
        │
        ▼
  pipe(PartialAnalysisReport)
        │
        ├─ aggregateInsights       (deterministic)
        ├─ detectAnomalies         (deterministic)
        ├─ correlateAnomalies      (deterministic)
        └─ generateRecommendations (Groq — see below)
        │
        ▼
  writeJson + OutputSchema → report/output.json
```

The pipeline builds a shared `PartialAnalysisReport` step by step. Each middleware reads the state, adds its fields, and passes it on.


| Step                     | Adds to state                                              |
| ------------------------ | ---------------------------------------------------------- |
| `loadJson`               | raw `LogEntry[]` (not in state — passed to middlewares)    |
| `aggregateInsights`      | `insights`, `service_status_summary`                       |
| `detectAnomalies`        | `anomalies`                                                |
| `correlateAnomalies`     | `incident_clusters` (internal — not in output JSON)        |
| `generateRecommendations`| `recommendations`                                          |
| `writeJson`              | full `AnalysisReport` + `timestamp`                        |


### Middleware responsibilities

#### 1. `aggregateInsights` — window summary

**Role:** Turn the full log window into global metrics and a service status snapshot. No AI.

```
LogEntry[] (all lines)
        │
        ▼
  strategy fold (INSIGHT_AGGREGATORS)
   sum latency / error rate
   max CPU / memory / uptime
        │
        ▼
  groupServiceStatus (scan all lines)
        │
        ▼
state.insights              state.service_status_summary
(averages + maxes)          (online / degraded / offline lists)
```

**Output fields:**
- `insights`: `average_latency_ms`, `max_cpu_usage`, `max_memory_usage`, `error_rate`, `uptime_seconds`
- `service_status_summary`: each service listed under every status it had in the window (a service can appear in multiple buckets if it changed state)

**Does not:** flag spikes, call Groq, or drop log lines.

---

#### 2. `detectAnomalies` — spike detection

**Role:** Scan each log line and keep only abnormal events. Rules are fixed thresholds, not AI.

```
LogEntry[] (one line at a time)
        │
        ▼
  strategy per metric (ANOMALY_STRATEGIES)
   CPU / latency / error rate / memory / disk / temperature
        │
        ▼
state.anomalies[]     (flat list, one entry per spike)
```

**Rules:**

| Metric | Medium | High |
| ------ | ------ | ---- |
| CPU | ≥ 85% | ≥ 95% |
| latency | ≥ 250 ms | ≥ 350 ms |
| error rate | — | ≥ 0.05 |
| memory | ≥ 85% | ≥ 90% |
| disk | ≥ 85% | ≥ 90% |
| temperature | ≥ 80°C | ≥ 85°C |

New rules are added as strategies in `ANOMALY_STRATEGIES` — no schema change needed.

**Output:** full list of anomalies (303 on sample data). Nothing is grouped or filtered here.

**Does not:** aggregate metrics, suggest fixes, or call Groq.

---

#### 3. `correlateAnomalies` — link related spikes

**Role:** Group anomalies into incident clusters so Groq sees related signals, not isolated metrics. No AI.

```
LogEntry[] + anomalies from detectAnomalies
        │
        ├─ co-occurrence: 2+ metrics spike on the same log
        └─ temporal cascade: latency spike on log N, error rate on log N+1
        │
        ▼
state.incident_clusters[]
```

**Cluster types:**

| Type | Rule | Example |
| ---- | ---- | ------- |
| `co_occurrence` | ≥ 2 metrics abnormal on the same timestamp | CPU + latency + error rate at 12:00 |
| `temporal_cascade` | `latency_ms` spike then `error_rate` spike on the next log | Timeouts causing errors |

**Output:** `incident_clusters` on pipeline state only (used to build Groq jobs, not written to `output.json`).

**Does not:** remove anomalies from the list or call Groq directly.

---

#### 4. `generateRecommendations` — DevOps actions (Groq)

**Role:** Turn insights + anomalies + service status into a short list of actionable recommendations. Detection stays complete; only recommendations are condensed.

```
state.insights
state.incident_clusters  ──► cluster prompts (co-occurrence / cascade)
state.anomalies          ──► groupAnomaliesByMetric (timestamps not covered by a cluster)
state.service_status_summary      build prompts
        │
        ▼
  Pass 1 — draft calls (sequential)
   1 Groq call / incident cluster
   1 Groq call / remaining metric group
   1 Groq call for degraded + offline services
        │
        ▼
  Pass 2 — synthesis call
   merge duplicates, rank by urgency
        │
        ▼
state.recommendations[]   (short ranked list; count depends on Groq quota)
```

**Input used:** global `insights`, grouped anomaly summaries (not every spike line), unhealthy services, allowed targets (`database`, `api_gateway`, `cache`).

**Output:** ranked recommendations with IDs (`REC-001`, …). If synthesis returns nothing, drafts are kept.

**Does not:** change the anomaly list, recompute metrics, or invent services outside the observed set.

Details: [Groq recommendations](#groq-recommendations) below.

## Groq recommendations

### Provider and model

- **Groq**: OpenAI-compatible API → `openai` client + `GROQ_BASE_URL`. Free tier is enough for this test.
- **`openai/gpt-oss-20b`**: supports `json_schema` + `strict: true` (needed to constrain output). Good enough for short DevOps recommendations with a clear prompt.
- **Structured outputs**: Zod builds the JSON Schema (`z.toJSONSchema`) sent to Groq; the parser uses `safeParse` on the response.
- **Free tier quota (8k TPM)**: see [API throttling and resilience](#api-throttling-and-resilience) below.

### API throttling and resilience

**Spacing calls**  
Groq calls run **one after another**, not in parallel. There is a 2 s pause between jobs (`GROQ_BATCH_PAUSE_MS`, default 2000 ms) to stay under the free tier (8k TPM). Each call sends one **metric group** or one **status block**, not a batch of raw anomalies. The goal is to avoid 429 errors.

**429 (rate limit)**  
On 429, the client waits for the delay in `retry-after` or the “try again in Xs” message, then retries up to `GROQ_MAX_RETRIES` (default 3). This retry budget is **separate** from schema errors. If 429 persists, the job is **skipped** (empty recommendations for that group) and the pipeline continues.

**400 (JSON schema / truncated output)**  
Groq may return 400 with `json_validate_failed` when strict schema validation fails — often because output was **cut off** (`max_tokens: 2048`) or quota limited the response. The client then:

1. **Recovers** partial JSON from `failed_generation` (if parseable → recommendations extracted, 0 extra tokens)
2. **Retries** the job (up to `GROQ_MAX_RETRIES`) if `failed_generation` is empty or truncated
3. **Skips** the group if retries fail

429 and schema retry counters are **independent**.

### Two-pass workflow

The middleware splits **detection** (full list of spikes) from **recommendation** (a few actions for a CTO).

**Pass 1 — draft generation**

Each Groq call is isolated; the model does not see recommendations from previous calls.


| Step              | Input sent                                                                 | Goal                                              |
| ----------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| 1 call / metric   | Group summary (`count`, `min`, `max`, `bySeverity`, 2 worst `examples`)   | 1–2 recos per spike type (CPU, latency, error rate) |
| 1 call for status | `degraded` / `offline` services                                            | 1 reco per service to fix                         |


**Why group by metric?** On the sample data, 303 spikes = 6 metrics. Sending each spike would mean hundreds of calls, many tokens, and repeated recommendations. Groq gets the scale (`count: 49`) without reading 49 lines. Grouping is only for the prompt.

**Pass 2 — synthesis**

One final call gets all drafts + insights + `service_status_summary`. It does not create new actions. It **merges** semantic duplicates (e.g. `increase_ttl` and `increase_cache_ttl` at 3600 s) and **ranks** by urgency:

1. restore **offline**
2. stabilize **degraded**
3. **metric** optimizations

If synthesis returns an empty list, drafts are kept.

Typical result: ~8 Groq calls (6 metric groups + status + synthesis), a short ranked list instead of hundreds of near-duplicates.

## Technical choices

Usual stack (Node + TypeScript, ~9 years backend and frontend): strict typing, Node CLI, compile-time validation, no extra framework.


| Choice              | Why                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js 20+**     | Good fit for a JSON CLI + HTTP calls.                                                                                                  |
| **TypeScript 6**    | Typed pipeline (`PartialAnalysisReport` → `AnalysisReport`), `#` aliases. `npx tsc --noEmit`, no JS build. TS 7 skipped: `typescript-eslint` not ready yet. |
| **Zod 4**           | Validate input/output, infer types (`z.infer`), parse Groq responses (`safeParse`), build JSON Schema (`z.toJSONSchema`) — one contract. |
| **tsx**             | Run the CLI directly (`tsx --env-file=.env`).                                                                                          |
| **OpenAI SDK**      | Groq entry point; `maxRetries: 0`, 429/400 handling in `services/groq`.                                                               |
| **Vitest**          | Jest-like API; native ESM, `#` aliases, Groq mocks (`vi.mock` + `await import`). 85% coverage on middlewares.                        |
| **ESLint + Prettier** | TS lint + formatting.                                                                                                                |


### Middlewares, not LangGraph

Linear flow: load → aggregate → detect → recommend → write. `pipe(step, step, step)` is enough. No graph, agent loop, or tool-calling. LangGraph would add complexity for a problem already solved with testable middlewares.

Patterns used: **strategy** for insights/anomalies, **reusable service** for Groq, **injectable logger**, **helpers** (`pipe`, `loadJson`, `writeJson`, `logger`), one folder per step with `index.ts` re-exports.

### Groq service layer

The Groq client lives outside the recommendations middleware to separate **transport** from **business logic**:

```
generateRecommendations ──► services/groq ──► Groq API
         (prompts, grouping)     (429, retries, structured chat)
```

- **`src/services/groq`**: OpenAI client, pause between calls, 429/400 retries, generic structured outputs (`responseFormat` + `parse` injected).
- **`src/middlewares/generateRecommendations`**: anomaly grouping, DevOps prompts, synthesis — uses the service via a thin wrapper (`requestRecommendations.ts`).

Another middleware can reuse `requestGroqWithRetry` with a different JSON schema without duplicating quota handling.

## Repo structure


| Folder                       | Role                          |
| ---------------------------- | ----------------------------- |
| `src/scripts/logAnalyzer.ts` | CLI orchestrator              |
| `src/middlewares/*`          | one pipeline step             |
| `src/services/groq`          | reusable Groq client          |
| `src/helpers/*`              | shared utilities              |
| `src/types/schema.ts`        | Zod contracts + inferred types |
| `data/`                      | input logs                    |
| `report/`                    | generated output              |

## Future analysis directions

The current pipeline focuses on a small set of infra metrics with clear thresholds. The architecture is built to grow without rewriting the flow.

**More anomaly strategies**  
`LogEntry` exposes 15+ numeric fields. Candidates not covered yet: `io_wait`, `active_connections`, `network_in_kbps`, `power_consumption_watts`. Each new rule is one strategy in `ANOMALY_STRATEGIES` plus thresholds in `detectAnomalies.constants.ts`.

**Richer correlation rules**  
`correlateAnomalies` already handles same-log co-occurrence and latency→error cascades. Next step: sliding time windows, service-status correlation, or cross-metric root-cause scoring.

**Richer insights**  
`aggregateInsights` could add percentiles (p95 latency), trend deltas between windows, or per-service breakdowns — still deterministic, still before Groq.

**Smarter grouping before Groq**  
Group by service + metric, or by time bucket, to reduce API calls when anomaly volume grows.

**Cloud-aware recommendations**  
Sample logs do not expose a cloud platform (no region, RDS, GKE, etc.), so prompts stay vendor-neutral by default. When the platform is known, an optional env var (e.g. `CLOUD_PROVIDER=aws|gcp|azure`) could inject context into the user prompt — not the system prompt — so Groq can use provider-specific wording in `action` and `parameters` (e.g. RDS failover, Cloud SQL read replica, ALB timeout) while `target` remains limited to observed services (`database`, `api_gateway`, `cache`). When unset, the prompt should explicitly say the platform is unknown and keep recommendations generic to avoid hallucinated cloud details.

**Non-threshold detection**  
Z-score or rolling baseline for metrics without fixed limits. Keeps `detectAnomalies` deterministic if the algorithm is fixed and tested.

**Service status as anomalies**  
Today degraded/offline services trigger a separate Groq pass, not an `anomalies[]` entry. Could unify under one model if the output schema evolves.

**Observability**  
Replace console logger with structured logs (JSON), metrics on Groq latency / 429 rate, or export to OpenTelemetry.

**Caching Groq responses**  
Hash prompt + model → cache drafts when re-running the same logs during development.
