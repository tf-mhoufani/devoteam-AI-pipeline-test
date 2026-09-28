import type { IncidentCluster, LogEntry, Severity } from "#types/schema";

const SEVERITY_RANK: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export const metricsSignature = (metrics: string[]): string =>
  [...new Set(metrics)].sort().join("|");

export const worstSeverity = (severities: Severity[]): Severity =>
  severities.reduce(
    (worst, severity) =>
      SEVERITY_RANK[severity] > SEVERITY_RANK[worst] ? severity : worst,
    "low" as Severity,
  );

export const sortLogsByTime = (logs: LogEntry[]): LogEntry[] =>
  [...logs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

type ClusterAccumulator = {
  metrics: string[];
  timestamps: string[];
  severities: Severity[];
};

export const toIncidentCluster = (
  type: IncidentCluster["type"],
  index: number,
  { metrics, timestamps, severities }: ClusterAccumulator,
  logCount = timestamps.length,
): IncidentCluster => {
  const sortedMetrics = [...new Set(metrics)].sort();
  const severity = worstSeverity(severities);

  const description =
    type === "co_occurrence"
      ? `${logCount} log(s) with simultaneous spikes on ${sortedMetrics.join(", ")}`
      : `${logCount} cascade(s): ${TEMPORAL_CAUSE_LABEL} followed by ${TEMPORAL_EFFECT_LABEL}`;

  return {
    id: `CLU-${String(index + 1).padStart(3, "0")}`,
    type,
    metrics: sortedMetrics,
    timestamps: [...timestamps].sort(),
    severity,
    log_count: logCount,
    description,
  };
};

const TEMPORAL_CAUSE_LABEL = "latency";
const TEMPORAL_EFFECT_LABEL = "error rate";
