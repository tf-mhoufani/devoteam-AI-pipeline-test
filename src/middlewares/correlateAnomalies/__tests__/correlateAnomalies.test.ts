import { describe, expect, it } from "vitest";
import { correlateAnomalies } from "#middlewares/correlateAnomalies";
import { createLog } from "../../fixtures";

describe("correlateAnomalies", () => {
  it("returns empty clusters when logs are empty", () => {
    const result = correlateAnomalies([], { anomalies: [] });
    expect(result.incident_clusters).toEqual([]);
  });

  it("detects co-occurrence when multiple metrics spike on the same log", () => {
    const result = correlateAnomalies(
      [
        createLog({
          cpu_usage: 96,
          latency_ms: 360,
          error_rate: 0.08,
        }),
      ],
      { anomalies: [] },
    );

    expect(result.incident_clusters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "co_occurrence",
          metrics: expect.arrayContaining([
            "cpu_usage",
            "latency_ms",
            "error_rate",
          ]),
          log_count: 1,
        }),
      ]),
    );
  });

  it("groups co-occurrence clusters by metric signature", () => {
    const result = correlateAnomalies(
      [
        createLog({ cpu_usage: 96, latency_ms: 360 }),
        createLog({
          timestamp: "2023-10-01T13:00:00Z",
          cpu_usage: 97,
          latency_ms: 400,
        }),
      ],
      { anomalies: [] },
    );

    const coOccurrence = result.incident_clusters?.filter(
      (cluster) => cluster.type === "co_occurrence",
    );

    expect(coOccurrence).toHaveLength(1);
    expect(coOccurrence?.[0]).toMatchObject({
      metrics: ["cpu_usage", "latency_ms"],
      log_count: 2,
    });
  });

  it("detects temporal cascade when latency is followed by error rate", () => {
    const result = correlateAnomalies(
      [
        createLog({ latency_ms: 360, error_rate: 0.01 }),
        createLog({
          timestamp: "2023-10-01T13:00:00Z",
          latency_ms: 120,
          error_rate: 0.08,
        }),
      ],
      { anomalies: [] },
    );

    const cascade = result.incident_clusters?.find(
      (cluster) => cluster.type === "temporal_cascade",
    );

    expect(cascade).toMatchObject({
      log_count: 1,
      timestamps: expect.arrayContaining([
        "2023-10-01T12:00:00Z",
        "2023-10-01T13:00:00Z",
      ]),
      metrics: expect.arrayContaining(["latency_ms", "error_rate"]),
    });
  });

  it("does not create co-occurrence for a single-metric spike", () => {
    const result = correlateAnomalies(
      [createLog({ cpu_usage: 96 })],
      { anomalies: [] },
    );

    expect(
      result.incident_clusters?.some(
        (cluster) => cluster.type === "co_occurrence",
      ),
    ).toBe(false);
  });
});
