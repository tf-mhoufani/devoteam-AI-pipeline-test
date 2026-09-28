import { describe, expect, it } from "vitest";
import { groupAnomaliesByMetric } from "../groupAnomaliesByMetric";
import type { Anomaly } from "#types/schema";

const anomaly = (overrides: Partial<Anomaly>): Anomaly => ({
  metric: "cpu_usage",
  value: 90,
  threshold: 85,
  severity: "medium",
  timestamp: "2023-10-01T12:00:00Z",
  description: "CPU",
  ...overrides,
});

describe("groupAnomaliesByMetric", () => {
  it("returns an empty list when there is no anomaly", () => {
    expect(groupAnomaliesByMetric([])).toEqual([]);
  });

  it("collapses peaks of the same metric and keeps the worst examples", () => {
    const groups = groupAnomaliesByMetric([
      anomaly({ metric: "cpu_usage", value: 86, severity: "medium" }),
      anomaly({ metric: "cpu_usage", value: 99, severity: "high" }),
      anomaly({ metric: "cpu_usage", value: 88, severity: "medium" }),
      anomaly({
        metric: "latency_ms",
        value: 260,
        threshold: 250,
        severity: "medium",
        description: "Latency",
      }),
    ]);

    expect(groups).toEqual([
      {
        metric: "cpu_usage",
        count: 3,
        min: 86,
        max: 99,
        bySeverity: { high: 1, medium: 2 },
        examples: [
          anomaly({ metric: "cpu_usage", value: 99, severity: "high" }),
          anomaly({ metric: "cpu_usage", value: 88, severity: "medium" }),
        ],
      },
      {
        metric: "latency_ms",
        count: 1,
        min: 260,
        max: 260,
        bySeverity: { medium: 1 },
        examples: [
          anomaly({
            metric: "latency_ms",
            value: 260,
            threshold: 250,
            severity: "medium",
            description: "Latency",
          }),
        ],
      },
    ]);
  });
});
