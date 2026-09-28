import { readPositiveIntFromEnv } from "#helpers/readPositiveIntFromEnv";

/** Pause between Groq calls to stay under the free-tier 8k TPM budget. */
export const DEFAULT_BATCH_PAUSE_MS = 2_000;

/** Maximum number of retries for rate limit and schema errors. */
export const DEFAULT_MAX_RETRIES = 3;

export const getBatchPauseMs = (): number => {
  if (process.env.VITEST) return 0;
  const fromEnv = Number(process.env.GROQ_BATCH_PAUSE_MS);
  return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : DEFAULT_BATCH_PAUSE_MS;
};

/** `GROQ_MAX_RETRIES` overlay, defaults to `DEFAULT_MAX_RETRIES`. */
export const getMaxRetries = (): number =>
  readPositiveIntFromEnv("GROQ_MAX_RETRIES", DEFAULT_MAX_RETRIES);
