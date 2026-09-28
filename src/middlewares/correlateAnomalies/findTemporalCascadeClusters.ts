import { anomaliesForLog } from "#middlewares/detectAnomalies";
import type { IncidentCluster, LogEntry, Severity } from "#types/schema";
import {
  TEMPORAL_CAUSE_METRIC,
  TEMPORAL_EFFECT_METRIC,
} from "./correlateAnomalies.constants";
import { sortLogsByTime, toIncidentCluster } from "./correlateAnomalies.helpers";

type CascadeAccumulator = {
  metrics: string[];
  timestamps: string[];
  severities: Severity[];
};

/**
 * Detects latency spikes immediately followed by error-rate spikes on the next log line.
 */
export const findTemporalCascadeClusters = (
  logs: LogEntry[],
): IncidentCluster[] => {
  const sorted = sortLogsByTime(logs);
  const accumulator: CascadeAccumulator = {
    metrics: [TEMPORAL_CAUSE_METRIC, TEMPORAL_EFFECT_METRIC],
    timestamps: [],
    severities: [],
  };

  let cascadeCount = 0;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index];
    const next = sorted[index + 1];
    if (!current || !next) continue;

    const currentMetrics = new Set(
      anomaliesForLog(current).map((anomaly) => anomaly.metric),
    );
    const nextMetrics = new Set(
      anomaliesForLog(next).map((anomaly) => anomaly.metric),
    );

    if (
      !currentMetrics.has(TEMPORAL_CAUSE_METRIC) ||
      !nextMetrics.has(TEMPORAL_EFFECT_METRIC)
    ) {
      continue;
    }

    cascadeCount += 1;
    accumulator.timestamps.push(current.timestamp, next.timestamp);
    accumulator.severities.push(
      ...anomaliesForLog(current)
        .filter((anomaly) => anomaly.metric === TEMPORAL_CAUSE_METRIC)
        .map((anomaly) => anomaly.severity),
      ...anomaliesForLog(next)
        .filter((anomaly) => anomaly.metric === TEMPORAL_EFFECT_METRIC)
        .map((anomaly) => anomaly.severity),
    );
  }

  if (accumulator.timestamps.length === 0) return [];

  return [toIncidentCluster("temporal_cascade", 0, accumulator, cascadeCount)];
};
