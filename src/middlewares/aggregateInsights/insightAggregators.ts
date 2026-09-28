import type { LogEntry, PartialAnalysisReport } from "#types/schema";

type Insights = NonNullable<PartialAnalysisReport["insights"]>;
type ServiceStatusSummary = NonNullable<PartialAnalysisReport["service_status_summary"]>;

type InsightAccumulator = {
  totalLatency: number;
  totalErrorRate: number;
  maxCpu: number;
  maxMemory: number;
  maxUptime: number;
};

/**
 * Folds one metric of a log into the running totals / maxes.
 * New insight metrics are added as a strategy in INSIGHT_AGGREGATORS.
 */
export interface InsightAggregator {
  apply(acc: InsightAccumulator, log: LogEntry): InsightAccumulator;
}

export const INITIAL_INSIGHT_ACCUMULATOR: InsightAccumulator = {
  totalLatency: 0,
  totalErrorRate: 0,
  maxCpu: 0,
  maxMemory: 0,
  maxUptime: 0,
};

const sumLatency: InsightAggregator = {
  apply: (acc, log) => ({
    ...acc,
    totalLatency: acc.totalLatency + log.latency_ms,
  }),
};

const sumErrorRate: InsightAggregator = {
  apply: (acc, log) => ({
    ...acc,
    totalErrorRate: acc.totalErrorRate + log.error_rate,
  }),
};

const maxCpu: InsightAggregator = {
  apply: (acc, log) => ({
    ...acc,
    maxCpu: Math.max(acc.maxCpu, log.cpu_usage),
  }),
};

const maxMemory: InsightAggregator = {
  apply: (acc, log) => ({
    ...acc,
    maxMemory: Math.max(acc.maxMemory, log.memory_usage),
  }),
};

const maxUptime: InsightAggregator = {
  apply: (acc, log) => ({
    ...acc,
    maxUptime: Math.max(acc.maxUptime, log.uptime_seconds),
  }),
};

export const INSIGHT_AGGREGATORS: InsightAggregator[] = [
  sumLatency,
  sumErrorRate,
  maxCpu,
  maxMemory,
  maxUptime,
];

export const toInsights = (
  acc: InsightAccumulator,
  count: number,
): Insights => ({
  average_latency_ms: Math.round(acc.totalLatency / count),
  max_cpu_usage: acc.maxCpu,
  max_memory_usage: acc.maxMemory,
  error_rate: Number((acc.totalErrorRate / count).toFixed(4)),
  uptime_seconds: acc.maxUptime,
});

/**
 * Lists each service under every status it had in the log window.
 * A name can appear in several buckets if it changed over time.
 */
export const groupServiceStatus = (logs: LogEntry[]): ServiceStatusSummary => {
  const seen: Record<keyof ServiceStatusSummary, Set<string>> = {
    online: new Set(),
    degraded: new Set(),
    offline: new Set(),
  };

  for (const log of logs) {
    for (const [serviceName, status] of Object.entries(log.service_status)) {
      seen[status].add(serviceName);
    }
  }

  return {
    online: [...seen.online],
    degraded: [...seen.degraded],
    offline: [...seen.offline],
  };
};
