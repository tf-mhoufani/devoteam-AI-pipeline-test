import type { LogEntry, PartialAnalysisReport } from "#types/schema";
import {
  INITIAL_INSIGHT_ACCUMULATOR,
  INSIGHT_AGGREGATORS,
  groupServiceStatus,
  toInsights,
} from "./insightAggregators";

/**
 * Builds global insights and a service-status snapshot from the full log
 * window, then merges them into the pipeline state.
 */
export const aggregateInsights = (
  logs: LogEntry[],
  state: PartialAnalysisReport,
): PartialAnalysisReport => {
  if (logs.length === 0) {
    throw new Error("No log entries provided");
  }

  const totals = logs.reduce(
    (acc, log) =>
      INSIGHT_AGGREGATORS.reduce(
        (next, aggregator) => aggregator.apply(next, log),
        acc,
      ),
    INITIAL_INSIGHT_ACCUMULATOR,
  );

  const lastLog = logs[logs.length - 1];

  return {
    ...state,
    insights: toInsights(totals, logs.length),
    service_status_summary: groupServiceStatus(lastLog?.service_status ?? {}),
  };
};
