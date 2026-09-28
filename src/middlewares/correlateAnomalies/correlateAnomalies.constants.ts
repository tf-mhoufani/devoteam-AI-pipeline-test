/** Minimum distinct metrics on the same log to form a co-occurrence cluster. */
export const MIN_CO_OCCURRENCE_METRICS = 2;

/** Cause metric for temporal cascade detection (latency spike then errors). */
export const TEMPORAL_CAUSE_METRIC = "latency_ms";

/** Effect metric for temporal cascade detection. */
export const TEMPORAL_EFFECT_METRIC = "error_rate";
