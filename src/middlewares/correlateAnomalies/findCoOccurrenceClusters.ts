import { anomaliesForLog } from "#middlewares/detectAnomalies";
import type { IncidentCluster, LogEntry, Severity } from "#types/schema";
import { MIN_CO_OCCURRENCE_METRICS } from "./correlateAnomalies.constants";
import {
  metricsSignature,
  toIncidentCluster,
} from "./correlateAnomalies.helpers";

type ClusterAccumulator = {
  metrics: string[];
  timestamps: string[];
  severities: Severity[];
};

/**
 * Groups logs where multiple metrics spike on the same timestamp.
 */
export const findCoOccurrenceClusters = (logs: LogEntry[]): IncidentCluster[] => {
  const bySignature = new Map<string, ClusterAccumulator>();

  for (const log of logs) {
    const triggered = anomaliesForLog(log);
    const metrics = [...new Set(triggered.map((anomaly) => anomaly.metric))];

    if (metrics.length < MIN_CO_OCCURRENCE_METRICS) continue;

    const signature = metricsSignature(metrics);
    const current = bySignature.get(signature) ?? {
      metrics,
      timestamps: [],
      severities: [],
    };

    current.timestamps.push(log.timestamp);
    current.severities.push(...triggered.map((anomaly) => anomaly.severity));
    bySignature.set(signature, current);
  }

  return [...bySignature.values()].map((accumulator, index) =>
    toIncidentCluster("co_occurrence", index, accumulator),
  );
};
