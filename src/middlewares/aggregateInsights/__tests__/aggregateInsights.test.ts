import { describe, expect, it } from "vitest";
import { aggregateInsights } from "#middlewares/aggregateInsights";
import { createLog } from "../../fixtures";

describe("aggregateInsights", () => {
  it("throws when logs are empty", () => {
    expect(() => aggregateInsights([], {})).toThrow("No log entries provided");
  });

  it("computes averages, maxes and keeps existing state", () => {
    const logs = [
      createLog({
        latency_ms: 100,
        cpu_usage: 40,
        memory_usage: 20,
        error_rate: 0.02,
        uptime_seconds: 100,
      }),
      createLog({
        latency_ms: 200,
        cpu_usage: 80,
        memory_usage: 60,
        error_rate: 0.04,
        uptime_seconds: 200,
        service_status: {
          database: "degraded",
          cache: "offline",
          api_gateway: "online",
        },
      }),
    ];

    const result = aggregateInsights(logs, { anomalies: [] });

    expect(result.insights).toEqual({
      average_latency_ms: 150,
      max_cpu_usage: 80,
      max_memory_usage: 60,
      error_rate: 0.03,
      uptime_seconds: 200,
    });
    expect(result.service_status_summary).toEqual({
      online: ["database", "api_gateway", "cache"],
      degraded: ["database"],
      offline: ["cache"],
    });
    expect(result.anomalies).toEqual([]);
  });
});
