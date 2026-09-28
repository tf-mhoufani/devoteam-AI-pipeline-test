import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutputSchema } from "#types/schema";
import { createLog } from "#test/fixtures";
import { silentLogger } from "#helpers/logger";

const generateRecommendations = vi.hoisted(() =>
  vi.fn(async (state: Record<string, unknown>) => ({
    ...state,
    recommendations: [
      {
        id: "REC-001",
        action: "Scale API",
        target: "api_gateway",
        parameters: { replicas: 3 },
        benefit_estimate: "Lower latency",
      },
    ],
  })),
);

vi.mock("#middlewares/generateRecommendations", () => ({
  generateRecommendations,
}));

const { infraLogAnalyzer } = await import("../infraLogAnalyzer");

describe("infraLogAnalyzer", () => {
  let tempDir: string;
  let inputPath: string;
  let outputPath: string;

  beforeEach(async () => {
    generateRecommendations.mockClear();
    tempDir = await mkdtemp(join(tmpdir(), "infra-log-analyzer-"));
    inputPath = join(tempDir, "input.json");
    outputPath = join(tempDir, "output.json");

    await writeFile(
      inputPath,
      JSON.stringify([
        createLog(),
        createLog({
          timestamp: "2023-10-01T13:00:00Z",
          cpu_usage: 98,
          latency_ms: 360,
          error_rate: 0.12,
          service_status: {
            database: "offline",
            api_gateway: "degraded",
            cache: "online",
          },
        }),
      ]),
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("runs the pipeline and writes a report that matches OutputSchema", async () => {
    await infraLogAnalyzer({ inputPath, outputPath, logger: silentLogger });

    const report = OutputSchema.parse(
      JSON.parse(await readFile(outputPath, "utf-8")),
    );

    expect(report.insights).toMatchObject({
      average_latency_ms: 230,
      max_cpu_usage: 98,
    });
    expect(report.anomalies.length).toBeGreaterThan(0);
    expect(report.recommendations).toEqual([
      {
        id: "REC-001",
        action: "Scale API",
        target: "api_gateway",
        parameters: { replicas: 3 },
        benefit_estimate: "Lower latency",
      },
    ]);
    expect(report.service_status_summary).toMatchObject({
      offline: ["database"],
      degraded: ["api_gateway"],
    });
    expect(report).not.toHaveProperty("incident_clusters");
    expect(generateRecommendations).toHaveBeenCalledOnce();
  });
});
