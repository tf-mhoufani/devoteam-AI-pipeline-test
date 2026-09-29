# Devoteam AI pipeline

Technical test: read infra logs (`data/rapport.json`), write a structured report (`report/output.json`) with insights, detected anomalies, and DevOps recommendations.

Metrics and anomalies are computed in deterministic TypeScript. Groq only suggests corrective actions, constrained by a strict output schema.

## Contents

**In this file**

- [Quick start](#quick-start)
- [What infraLogAnalyzer does](#what-infraloganalyzer-does)

**Architecture** ([docs/architecture.md](docs/architecture.md))

- [Technical choices](docs/architecture.md#technical-choices)
- [Repo structure](docs/architecture.md#repo-structure)
- [Pipeline overview](docs/architecture.md#pipeline-overview)
- [Middleware details](docs/architecture.md#middlewares)
- [Groq integration](docs/architecture.md#groq-integration)
- [Prompt design](docs/architecture.md#prompt-design)
- [Future directions](docs/architecture.md#future-directions)

---

## Quick start

**Requirements:** [Node.js](https://nodejs.org/) (includes `npm`), [Groq](https://console.groq.com/) API key (`GROQ_API_KEY`).

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

## What infraLogAnalyzer does

`infraLogAnalyzer` is the CLI entry point. It reads a JSON log file, runs the analysis, and writes a structured report.

**Input** — `./data/rapport.json` (infra metrics per service: CPU, latency, error rate, etc.)

**Output** — `./report/output.json` with:

| Field                    | What it contains                                              |
| ------------------------ | ------------------------------------------------------------- |
| `insights`               | Window averages and peaks across the log period               |
| `service_status_summary` | Which services were online, degraded, or offline              |
| `anomalies`              | Every detected spike (303 on sample data) — full list         |
| `recommendations`        | Short DevOps actions (typically ~3 after Groq synthesis)    |

**How it works (high level):**

1. Load and validate logs
2. Summarize the window (metrics + service health)
3. Flag abnormal values with fixed thresholds
4. Group related spikes into incidents (internal step — not in the output file)
5. Ask Groq for corrective recommendations, then merge duplicates
6. Validate and write the final JSON report

Metrics, anomalies, and correlation are **deterministic TypeScript**. Groq is used **only** for recommendations.

→ [Pipeline steps, middlewares, thresholds](docs/architecture.md#middlewares)  
→ [Groq integration, prompts, resilience](docs/architecture.md#groq-integration)
