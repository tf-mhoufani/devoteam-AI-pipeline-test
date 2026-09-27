import { readPositiveIntFromEnv } from "#helpers/readPositiveIntFromEnv";
import type { Severity } from "#types/schema";

/** Maximum number of anomalies per Groq call. */
export const ANOMALY_BATCH_SIZE = 10;

/** Pause between Groq calls to stay under the free-tier 8k TPM budget. */
export const BATCH_PAUSE_MS = 2_000;

/** Maximum number of retries for rate limit errors. */
export const MAX_RATE_LIMIT_RETRIES = 3;

/** `GROQ_BATCH_SIZE` overlay, defaults to `ANOMALY_BATCH_SIZE`. */
export const getAnomalyBatchSize = (): number =>
  readPositiveIntFromEnv("GROQ_BATCH_SIZE", ANOMALY_BATCH_SIZE);

/** `GROQ_MAX_RETRIES` overlay, defaults to `MAX_RATE_LIMIT_RETRIES`. */
export const getMaxRateLimitRetries = (): number =>
  readPositiveIntFromEnv("GROQ_MAX_RETRIES", MAX_RATE_LIMIT_RETRIES);

/** System prompt for the Groq API. */
export const GROQ_SYSTEM_PROMPT = `You are a senior DevOps engineer. Recommend concrete fixes for THIS infrastructure only.

Rules:
- Propose exactly one recommendation per anomaly in the user message.
- target MUST be one of the allowed service names listed in the user message. Never invent a service, cluster, or product name.
- Match the target to the metric when possible: cpu_usage or latency_ms → api_gateway; error_rate → database or api_gateway.
- Insights are window aggregates (averages and maxes), not the current live state. Anomalies are the peaks to fix.
- parameters.value MUST be a string, number, boolean, or an array of those. Do not nest objects.`;

/** Ranking of severity levels for anomaly selection. */
export const SEVERITY_RANK: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};
