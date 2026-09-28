import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { generateRecommendations } =
  await import("#middlewares/generateRecommendations");
const { getBatchPauseMs } = await import("#services/groq");
import type { PartialAnalysisReport } from "#types/schema";

const recommendation = (id: string) => ({
  id,
  action: "Scale API",
  target: "api_gateway",
  parameters: { replicas: 3 },
  benefit_estimate: "Lower latency",
});

const groqPayload = (id: string) => ({
  recommendations: [recommendation(id)],
});

const extractGroupFromPrompt = (prompt: string) =>
  JSON.parse(
    prompt.split("Anomaly group : ")[1]?.split("\n")[0]?.trim() ?? "{}",
  ) as {
    metric: string;
    count: number;
    examples: NonNullable<PartialAnalysisReport["anomalies"]>;
  };

describe("generateRecommendations", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  beforeEach(() => {
    create.mockReset();
    log.mockClear();
    warn.mockClear();
  });

  it.each([{ anomalies: undefined }, { anomalies: [] }])(
    "returns an empty list when there is no anomaly",
    async (state) => {
      const result = await generateRecommendations(
        state as PartialAnalysisReport,
      );
      expect(result.recommendations).toEqual([]);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: "object envelope",
      content: groqPayload("REC-001"),
    },
    {
      label: "bare array",
      content: [recommendation("REC-001")],
    },
    {
      label: "array-wrapped envelope",
      content: [groqPayload("REC-001")],
    },
  ])("parses Groq JSON as $label", async ({ content }) => {
    create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(content) } }],
    });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
    });

    expect(result.recommendations).toEqual([recommendation("REC-001")]);
    expect(create.mock.calls[0]?.[0].response_format).toMatchObject({
      type: "json_schema",
      json_schema: { name: "recommendations_envelope", strict: true },
    });
    expect(create.mock.calls[0]?.[0].messages[0]).toMatchObject({
      role: "system",
    });
  });

  it("lists observed services as the only allowed Groq targets", async () => {
    create.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify(groqPayload("REC-001")) } },
      ],
    });

    await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
      service_status_summary: {
        online: ["database", "cache"],
        degraded: ["api_gateway"],
        offline: [],
      },
    });

    expect(create.mock.calls[0]?.[0].messages[1].content).toContain(
      "Allowed targets: database, cache, api_gateway",
    );
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[1]?.[0].messages[1].content).toContain(
      'Unhealthy services to remediate : {"degraded":["api_gateway"],"offline":[]}',
    );
    expect(create.mock.calls[2]?.[0].messages[1].content).toContain(
      "Draft recommendations :",
    );
  });

  it("maps Groq key/value parameter pairs to a record", async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              recommendations: [
                {
                  id: "REC-001",
                  action: "Scale API",
                  target: "api_gateway",
                  parameters: [
                    { key: "replicas", value: 3 },
                    { key: "ttl", value: "60s" },
                    {
                      key: "profiled_endpoints",
                      value: ["GET /api/users", "POST /api/orders"],
                    },
                  ],
                  benefit_estimate: "Lower latency",
                },
              ],
            }),
          },
        },
      ],
    });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
    });

    expect(result.recommendations).toEqual([
      {
        id: "REC-001",
        action: "Scale API",
        target: "api_gateway",
        parameters: {
          replicas: 3,
          ttl: "60s",
          profiled_endpoints: ["GET /api/users", "POST /api/orders"],
        },
        benefit_estimate: "Lower latency",
      },
    ]);
  });

  it("keeps valid recommendations and drops leftover strings or incomplete items", async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              recommendations: [
                recommendation("REC-001"),
                {
                  id: "REC-002",
                  action: "Add cache",
                  target: "database",
                  parameters: { ttl: "60s" },
                },
                "Prevent cascading failures",
                "Keep error rate below 5%",
              ],
            }),
          },
        },
      ],
    });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
    });

    expect(result.recommendations).toEqual([
      recommendation("REC-001"),
      {
        id: "REC-002",
        action: "Add cache",
        target: "database",
        parameters: { ttl: "60s" },
        benefit_estimate: "",
      },
    ]);
  });

  it("groups anomalies by metric before Groq", async () => {
    create
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify(groqPayload("REC-A")) } },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify(groqPayload("REC-B")) } },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify(groqPayload("REC-C")) } },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                recommendations: [
                  recommendation("REC-KEEP-1"),
                  recommendation("REC-KEEP-2"),
                ],
              }),
            },
          },
        ],
      });

    const anomalies = [
      ...Array.from({ length: 3 }, (_, i) => ({
        metric: "cpu_usage",
        value: 70 + i,
        threshold: 85,
        severity: "low" as const,
        description: `low-${i}`,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        metric: "latency_ms",
        value: 260 + i,
        threshold: 250,
        severity: "medium" as const,
        description: `medium-${i}`,
      })),
      ...Array.from({ length: 8 }, (_, i) => ({
        metric: "error_rate",
        value: 0.1 + i,
        threshold: 0.05,
        severity: "high" as const,
        description: `high-${i}`,
      })),
    ];

    const result = await generateRecommendations({ anomalies });

    expect(create).toHaveBeenCalledTimes(4);

    const sent = create.mock.calls
      .slice(0, 3)
      .map(([payload]) => extractGroupFromPrompt(payload.messages[1].content));

    expect(sent.map(({ metric, count }) => ({ metric, count }))).toEqual([
      { metric: "error_rate", count: 8 },
      { metric: "latency_ms", count: 4 },
      { metric: "cpu_usage", count: 3 },
    ]);
    expect(sent.every((group) => group.examples.length === 2)).toBe(true);
    expect(create.mock.calls[3]?.[0].messages[0].content).toContain(
      "Merge draft recommendations",
    );
    expect(result.recommendations).toEqual([
      recommendation("REC-001"),
      recommendation("REC-002"),
    ]);
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      "Groq batch 1/3 (error_rate, 8 peaks)...",
      "1 recommendation(s) (1 total)",
      "Groq batch 2/3 (latency_ms, 4 peaks)...",
      "1 recommendation(s) (2 total)",
      "Groq batch 3/3 (cpu_usage, 3 peaks)...",
      "1 recommendation(s) (3 total)",
      "Groq synthesis (3 recommendations → filter and rank)...",
      "2 recommendation(s) after synthesis",
    ]);
  });

  it("asks Groq to remediate degraded and offline services", async () => {
    create
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify(groqPayload("REC-A")) } },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify(groqPayload("REC-B")) } },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                recommendations: [
                  recommendation("REC-DB"),
                  recommendation("REC-GW"),
                ],
              }),
            },
          },
        ],
      });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
      service_status_summary: {
        online: ["database", "cache", "api_gateway"],
        degraded: ["api_gateway", "cache", "database"],
        offline: ["database"],
      },
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[1]?.[0].messages[0].content).toContain(
      "Restore service health",
    );
    expect(create.mock.calls[1]?.[0].messages[1].content).toContain(
      'Unhealthy services to remediate : {"degraded":["api_gateway","cache"],"offline":["database"]}',
    );
    expect(result.recommendations).toEqual([
      recommendation("REC-001"),
      recommendation("REC-002"),
    ]);
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      "Groq batch 1/2 (cpu_usage, 1 peaks)...",
      "1 recommendation(s) (1 total)",
      "Groq batch 2/2 (service_status: degraded api_gateway, cache; offline database)...",
      "1 recommendation(s) (2 total)",
      "Groq synthesis (2 recommendations → filter and rank)...",
      "2 recommendation(s) after synthesis",
    ]);
  });

  it("still remediates unhealthy services when there is no anomaly", async () => {
    create.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify(groqPayload("REC-001")) } },
      ],
    });

    const result = await generateRecommendations({
      anomalies: [],
      service_status_summary: {
        online: [],
        degraded: [],
        offline: ["database"],
      },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.recommendations).toEqual([recommendation("REC-001")]);
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      "Groq batch 1/1 (service_status: degraded none; offline database)...",
      "1 recommendation(s) (1 total)",
    ]);
  });

  it("keeps drafts when Groq synthesis returns nothing", async () => {
    create
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify(groqPayload("REC-A")) } },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify(groqPayload("REC-B")) } },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify({ recommendations: [] }) } },
        ],
      });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
        {
          metric: "latency_ms",
          value: 400,
          threshold: 250,
          severity: "high",
          description: "Latency",
        },
      ],
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(result.recommendations).toEqual([
      recommendation("REC-001"),
      recommendation("REC-002"),
    ]);
    expect(warn).toHaveBeenCalled();
  });

  it("retries a group after a Groq 429", async () => {
    create
      .mockRejectedValueOnce({
        status: 429,
        message: "Please try again in 10ms",
        headers: { get: () => "0" },
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify(groqPayload("REC-001")) } },
        ],
      });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.recommendations).toEqual([recommendation("REC-001")]);
  });

  it("retries a 429 even after schema mismatches on the same group", async () => {
    create
      .mockRejectedValueOnce({
        status: 400,
        code: "json_validate_failed",
        error: { code: "json_validate_failed", failed_generation: "" },
      })
      .mockRejectedValueOnce({
        status: 429,
        message: "Please try again in 17.595s",
        headers: { get: () => "0" },
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify(groqPayload("REC-001")) } },
        ],
      });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(result.recommendations).toEqual([recommendation("REC-001")]);
  });

  it("skips a group when Groq 429 persists", async () => {
    create.mockRejectedValue({
      status: 429,
      message: "Please try again in 10ms",
      headers: { get: () => "0" },
    });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
    });

    expect(create).toHaveBeenCalledTimes(4);
    expect(result.recommendations).toEqual([]);
  });

  it("recovers recommendations from a Groq schema mismatch", async () => {
    create.mockRejectedValue({
      status: 400,
      error: {
        code: "json_validate_failed",
        failed_generation: JSON.stringify(groqPayload("REC-001")),
      },
    });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
    });

    expect(result.recommendations).toEqual([recommendation("REC-001")]);
    expect(warn).toHaveBeenCalled();
  });

  it("retries when failed_generation is truncated JSON", async () => {
    create
      .mockRejectedValueOnce({
        status: 400,
        error: {
          code: "json_validate_failed",
          failed_generation: '{"recommendations":[{"id":"rec1"',
        },
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify(groqPayload("REC-001")) } },
        ],
      });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.recommendations).toEqual([recommendation("REC-001")]);
  });

  it("retries when Groq returns an empty failed_generation", async () => {
    create
      .mockRejectedValueOnce({
        status: 400,
        code: "json_validate_failed",
        error: {
          code: "json_validate_failed",
          failed_generation: "",
        },
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify(groqPayload("REC-001")) } },
        ],
      });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.recommendations).toEqual([recommendation("REC-001")]);
  });

  it("skips a group when failed_generation stays unreadable", async () => {
    create.mockRejectedValue({
      status: 400,
      error: {
        code: "json_validate_failed",
        failed_generation: '{"recommendations":[{"id":"rec1"',
      },
    });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
    });

    expect(create).toHaveBeenCalledTimes(4);
    expect(result.recommendations).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  it.each([
    { message: "Please try again in 10ms" },
    { message: "Please try again in 0.01s" },
    { message: "rate limited" },
    { message: "Please try again in . ms" },
  ])("retries a 429 from message timing: $message", async ({ message }) => {
    create
      .mockRejectedValueOnce({
        status: 429,
        message,
      })
      .mockResolvedValueOnce({
        choices: [
          { message: { content: JSON.stringify(groqPayload("REC-001")) } },
        ],
      });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          description: "CPU",
        },
      ],
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.recommendations).toEqual([recommendation("REC-001")]);
  });

  it.each([
    { pause: "1500", expected: 1500 },
    { pause: "not-a-number", expected: 2000 },
    { pause: undefined, expected: 2000 },
  ])(
    "reads GROQ_BATCH_PAUSE_MS as $expected when VITEST is unset",
    ({ pause, expected }) => {
      const previousVitest = process.env.VITEST;
      const previousPause = process.env.GROQ_BATCH_PAUSE_MS;
      delete process.env.VITEST;
      if (pause === undefined) {
        delete process.env.GROQ_BATCH_PAUSE_MS;
      } else {
        process.env.GROQ_BATCH_PAUSE_MS = pause;
      }

      expect(getBatchPauseMs()).toBe(expected);

      process.env.VITEST = previousVitest;
      if (previousPause === undefined) {
        delete process.env.GROQ_BATCH_PAUSE_MS;
      } else {
        process.env.GROQ_BATCH_PAUSE_MS = previousPause;
      }
    },
  );

  it("still groups isolated anomalies by metric when their timestamp is not clustered", async () => {
    create.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify(groqPayload("REC-001")) } },
      ],
    });

    await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          timestamp: "2023-10-01T12:00:00Z",
          description: "CPU",
        },
        {
          metric: "latency_ms",
          value: 360,
          threshold: 250,
          severity: "high",
          timestamp: "2023-10-01T12:00:00Z",
          description: "Latency",
        },
        {
          metric: "error_rate",
          value: 0.08,
          threshold: 0.05,
          severity: "high",
          timestamp: "2023-10-01T19:30:00Z",
          description: "Errors",
        },
      ],
      incident_clusters: [
        {
          id: "CLU-001",
          type: "co_occurrence",
          metrics: ["cpu_usage", "latency_ms"],
          timestamps: ["2023-10-01T12:00:00Z"],
          severity: "high",
          log_count: 1,
          description: "combined spike",
        },
      ],
    });

    const metricGroupCalls = create.mock.calls.filter(([payload]) =>
      payload.messages[1].content.includes("Anomaly group"),
    );

    expect(metricGroupCalls).toHaveLength(1);
    expect(metricGroupCalls[0]?.[0].messages[1].content).toContain(
      "error_rate",
    );
  });

  it("does not expose incident_clusters on the returned state", async () => {
    create.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify(groqPayload("REC-001")) } },
      ],
    });

    const result = await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          timestamp: "2023-10-01T12:00:00Z",
          description: "CPU",
        },
      ],
      incident_clusters: [
        {
          id: "CLU-001",
          type: "co_occurrence",
          metrics: ["cpu_usage"],
          timestamps: ["2023-10-01T12:00:00Z"],
          severity: "high",
          log_count: 1,
          description: "cpu spike",
        },
      ],
    });

    expect(result.incident_clusters).toBeUndefined();
  });

  it("uses incident cluster jobs and skips correlated metric groups", async () => {
    create.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify(groqPayload("REC-001")) } },
      ],
    });

    await generateRecommendations({
      anomalies: [
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          timestamp: "2023-10-01T12:00:00Z",
          description: "CPU",
        },
        {
          metric: "latency_ms",
          value: 360,
          threshold: 250,
          severity: "high",
          timestamp: "2023-10-01T12:00:00Z",
          description: "Latency",
        },
        {
          metric: "memory_usage",
          value: 91,
          threshold: 90,
          severity: "high",
          timestamp: "2023-10-01T13:00:00Z",
          description: "Memory",
        },
      ],
      incident_clusters: [
        {
          id: "CLU-001",
          type: "co_occurrence",
          metrics: ["cpu_usage", "latency_ms"],
          timestamps: ["2023-10-01T12:00:00Z"],
          severity: "high",
          log_count: 1,
          description: "combined spike",
        },
        {
          id: "CLU-002",
          type: "temporal_cascade",
          metrics: ["latency_ms", "error_rate"],
          timestamps: [],
          severity: "high",
          log_count: 0,
          description: "empty cascade",
        },
      ],
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[0]?.[0].messages[0].content).toContain(
      "CORRELATED incident cluster",
    );
    expect(create.mock.calls[0]?.[0].messages[1].content).toContain(
      "Incident cluster",
    );
    expect(create.mock.calls[1]?.[0].messages[1].content).toContain(
      "memory_usage",
    );
    expect(create.mock.calls[2]?.[0].messages[1].content).toContain(
      "Draft recommendations",
    );
  });

  it("skips latency and error rate metric jobs when a temporal cascade exists", async () => {
    create.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify(groqPayload("REC-001")) } },
      ],
    });

    await generateRecommendations({
      anomalies: [
        {
          metric: "latency_ms",
          value: 360,
          threshold: 250,
          severity: "high",
          timestamp: "2023-10-01T12:00:00Z",
          description: "Latency",
        },
        {
          metric: "error_rate",
          value: 0.08,
          threshold: 0.05,
          severity: "high",
          timestamp: "2023-10-01T13:00:00Z",
          description: "Errors",
        },
        {
          metric: "cpu_usage",
          value: 98,
          threshold: 95,
          severity: "high",
          timestamp: "2023-10-01T14:00:00Z",
          description: "CPU",
        },
      ],
      incident_clusters: [
        {
          id: "CLU-001",
          type: "temporal_cascade",
          metrics: ["latency_ms", "error_rate"],
          timestamps: [
            "2023-10-01T12:00:00Z",
            "2023-10-01T13:00:00Z",
          ],
          severity: "high",
          log_count: 1,
          description: "cascade",
        },
      ],
    });

    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[0]?.[0].messages[1].content).toContain(
      "Incident cluster",
    );
    expect(create.mock.calls[1]?.[0].messages[1].content).toContain(
      "cpu_usage",
    );
    const metricGroupCalls = create.mock.calls.filter(([payload]) =>
      payload.messages[1].content.includes("Anomaly group"),
    );

    expect(metricGroupCalls).toHaveLength(1);
    expect(metricGroupCalls[0]?.[0].messages[1].content).toContain("cpu_usage");
    expect(
      metricGroupCalls.some(([payload]) =>
        payload.messages[1].content.includes("latency_ms"),
      ),
    ).toBe(false);
  });

  it("throws when Groq returns an empty body", async () => {
    create.mockResolvedValue({ choices: [{ message: { content: null } }] });

    await expect(
      generateRecommendations({
        anomalies: [
          {
            metric: "cpu_usage",
            value: 98,
            threshold: 95,
            severity: "high",
            timestamp: "2023-10-01T12:00:00Z",
            description: "CPU",
          },
        ],
      }),
    ).rejects.toThrow("Groq generation failed");
  });
});
