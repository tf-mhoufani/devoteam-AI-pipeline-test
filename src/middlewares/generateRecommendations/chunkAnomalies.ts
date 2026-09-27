import {
  getAnomalyBatchSize,
  SEVERITY_RANK,
} from "./generateRecommendations.constants";
import type { Anomaly } from "#types/schema";

/**
 * Splits anomalies into severity-ordered batches so every peak is sent to Groq
 * without overflowing a single JSON prompt.
 */
export const chunkAnomalies = (
  anomalies: Anomaly[],
  size = getAnomalyBatchSize(),
): Anomaly[][] => {
  const sorted = [...anomalies].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );

  return Array.from({ length: Math.ceil(sorted.length / size) }, (_, index) =>
    sorted.slice(index * size, (index + 1) * size),
  );
};
