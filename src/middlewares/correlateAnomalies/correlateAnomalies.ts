import type { PartialAnalysisReport } from "#types/schema";
import type { PipelineContext } from "#types/pipeline";
import { findCoOccurrenceClusters } from "./findCoOccurrenceClusters";
import { findTemporalCascadeClusters } from "./findTemporalCascadeClusters";

/**
 * Links anomalies into incident clusters: same-timestamp co-occurrence and
 * temporal cascades (latency spike followed by error-rate spike).
 */
export const correlateAnomalies = (
  state: PartialAnalysisReport,
  { logs }: PipelineContext,
): PartialAnalysisReport => {
  if (!logs || logs.length === 0) {
    return { ...state, incident_clusters: [] };
  }

  const coOccurrence = findCoOccurrenceClusters(logs);
  const temporal = findTemporalCascadeClusters(logs);

  const incident_clusters = [
    ...coOccurrence,
    ...temporal.map((cluster, index) => ({
      ...cluster,
      id: `CLU-${String(coOccurrence.length + index + 1).padStart(3, "0")}`,
    })),
  ];

  return {
    ...state,
    incident_clusters,
  };
};
