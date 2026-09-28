import type { Anomaly, LogEntry, PartialAnalysisReport } from "#types/schema";
import { ANOMALY_STRATEGIES } from "./anomalyStrategies";

export const anomaliesForLog = (log: LogEntry): Anomaly[] =>
  ANOMALY_STRATEGIES.flatMap((strategy) => {
    const anomaly = strategy.evaluate(log);
    return anomaly ? [anomaly] : [];
  });

/**
 * Isolates abnormal events from the raw logs so later nodes (and Groq)
 * only see relevant peaks instead of the full healthy timeline.
 */
export const detectAnomalies = (
  logs: LogEntry[],
  state: PartialAnalysisReport,
): PartialAnalysisReport => {
  if (!logs || logs.length === 0) return state;

  const anomalies = logs.flatMap((log) => anomaliesForLog(log));

  return {
    ...state,
    anomalies,
  };
};
