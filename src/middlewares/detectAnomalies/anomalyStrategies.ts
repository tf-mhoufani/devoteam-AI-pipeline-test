import { SeveritySchema, type Anomaly, type LogEntry } from "#types/schema";
import { THRESHOLDS } from "./detectAnomalies.constants";

type SeverityBand = {
  min: number;
  threshold: number;
  severity: Anomaly["severity"];
  description: (log: LogEntry) => string;
};

/**
 * Detects at most one anomaly for a given metric on a log line.
 * New business rules are added as a strategy in ANOMALY_STRATEGIES.
 */
export interface AnomalyStrategy {
  evaluate(log: LogEntry): Anomaly | undefined;
}

const firstMatchingBand = (
  value: number,
  bands: SeverityBand[],
): SeverityBand | undefined => bands.find((band) => value >= band.min);

const toAnomaly = (
  metric: Anomaly["metric"],
  value: number,
  log: LogEntry,
  band: SeverityBand,
): Anomaly => ({
  metric,
  value,
  threshold: band.threshold,
  severity: band.severity,
  description: band.description(log),
});

const cpuBands: SeverityBand[] = [
  {
    min: THRESHOLDS.cpuCritical,
    threshold: THRESHOLDS.cpuCritical,
    severity: SeveritySchema.enum.high,
    description: (log) =>
      `Critical CPU overload (${log.cpu_usage}%) recorded at ${log.timestamp}`,
  },
  {
    min: THRESHOLDS.cpuHigh,
    threshold: THRESHOLDS.cpuHigh,
    severity: SeveritySchema.enum.medium,
    description: (log) =>
      `Warning CPU peak (${log.cpu_usage}%) recorded at ${log.timestamp}`,
  },
];

const latencyBands: SeverityBand[] = [
  {
    min: THRESHOLDS.latencyCritical,
    threshold: THRESHOLDS.latencyHigh,
    severity: SeveritySchema.enum.high,
    description: (log) =>
      `Highly abnormal latency (${log.latency_ms} ms) recorded at ${log.timestamp}`,
  },
  {
    min: THRESHOLDS.latencyHigh,
    threshold: THRESHOLDS.latencyHigh,
    severity: SeveritySchema.enum.medium,
    description: (log) =>
      `Highly abnormal latency (${log.latency_ms} ms) recorded at ${log.timestamp}`,
  },
];

const errorRateBands: SeverityBand[] = [
  {
    min: THRESHOLDS.errorRateHigh,
    threshold: THRESHOLDS.errorRateHigh,
    severity: SeveritySchema.enum.high,
    description: (log) =>
      `Error rate at ${(log.error_rate * 100).toFixed(0)}% recorded at ${log.timestamp}`,
  },
];

const createThresholdStrategy = (
  metric: Anomaly["metric"],
  readValue: (log: LogEntry) => number,
  bands: SeverityBand[],
): AnomalyStrategy => ({
  evaluate(log) {
    const band = firstMatchingBand(readValue(log), bands);
    return band ? toAnomaly(metric, readValue(log), log, band) : undefined;
  },
});

export const cpuOverloadStrategy = createThresholdStrategy(
  "cpu_usage",
  (log) => log.cpu_usage,
  cpuBands,
);

export const latencyDegradationStrategy = createThresholdStrategy(
  "latency_ms",
  (log) => log.latency_ms,
  latencyBands,
);

export const errorRateStrategy = createThresholdStrategy(
  "error_rate",
  (log) => log.error_rate,
  errorRateBands,
);

export const ANOMALY_STRATEGIES: AnomalyStrategy[] = [
  cpuOverloadStrategy,
  latencyDegradationStrategy,
  errorRateStrategy,
];
