import { describe, expect, it } from "vitest";
import { detectAnomalies } from "#middlewares/detectAnomalies";
import { createLog, withLogs } from "#test/fixtures";
import type { PartialAnalysisReport } from "#types/schema";

describe("detectAnomalies", () => {
  it("returns the same state when logs are empty", () => {
    const state: PartialAnalysisReport = {
      insights: {
        average_latency_ms: 0,
        max_cpu_usage: 0,
        max_memory_usage: 0,
        error_rate: 0,
        uptime_seconds: 0,
      },
    };
    expect(detectAnomalies(state, withLogs([]))).toBe(state);
  });

  it.each([
    {
      cpu_usage: 95,
      expected: { metric: "cpu_usage", severity: "high", threshold: 95 },
    },
    {
      cpu_usage: 85,
      expected: { metric: "cpu_usage", severity: "medium", threshold: 85 },
    },
    {
      latency_ms: 350,
      expected: { metric: "latency_ms", severity: "high", threshold: 250 },
    },
    {
      latency_ms: 250,
      expected: { metric: "latency_ms", severity: "medium", threshold: 250 },
    },
    {
      error_rate: 0.05,
      expected: { metric: "error_rate", severity: "high", threshold: 0.05 },
    },
    {
      memory_usage: 90,
      expected: { metric: "memory_usage", severity: "high", threshold: 90 },
    },
    {
      memory_usage: 85,
      expected: { metric: "memory_usage", severity: "medium", threshold: 85 },
    },
    {
      disk_usage: 90,
      expected: { metric: "disk_usage", severity: "high", threshold: 90 },
    },
    {
      temperature_celsius: 85,
      expected: {
        metric: "temperature_celsius",
        severity: "high",
        threshold: 85,
      },
    },
  ])(
    "flags $expected.metric as $expected.severity",
    ({ expected, ...overrides }) => {
      const { anomalies } = detectAnomalies(
        {},
        withLogs([createLog(overrides)]),
      );
      expect(anomalies).toEqual(
        expect.arrayContaining([expect.objectContaining(expected)]),
      );
    },
  );

  it("does not flag healthy metrics", () => {
    const { anomalies } = detectAnomalies({}, withLogs([createLog()]));
    expect(anomalies).toEqual([]);
  });

  it("applies every matching strategy on the same log", () => {
    const { anomalies } = detectAnomalies(
      {},
      withLogs([
        createLog({
          cpu_usage: 96,
          latency_ms: 360,
          error_rate: 0.08,
          memory_usage: 91,
          disk_usage: 92,
          temperature_celsius: 86,
        }),
      ]),
    );

    expect(anomalies?.map((anomaly) => anomaly.metric)).toEqual([
      "cpu_usage",
      "latency_ms",
      "error_rate",
      "memory_usage",
      "disk_usage",
      "temperature_celsius",
    ]);
  });
});
