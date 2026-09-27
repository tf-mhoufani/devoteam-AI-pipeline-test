import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { generateRecommendations } = await import(
  "#middlewares/generateRecommendations"
);
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

const extractAnomaliesFromPrompt = (prompt: string) =>
  JSON.parse(
    prompt.split("Anomalies to fix : ")[1]?.split("\n")[0]?.trim() ?? "[]",
  ) as NonNullable<PartialAnalysisReport["anomalies"]>;

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
      const result = await generateRecommendations(state as PartialAnalysisReport);
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
      choices: [{ message: { content: JSON.stringify(groqPayload("REC-001")) } }],
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

  it("batches every anomaly across Groq calls", async () => {
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

    expect(create).toHaveBeenCalledTimes(2);

    const sent = create.mock.calls.flatMap(([payload]) =>
      extractAnomaliesFromPrompt(payload.messages[1].content),
    );

    expect(sent).toHaveLength(15);
    expect(sent.filter((anomaly) => anomaly.severity === "high")).toHaveLength(
      8,
    );
    expect(sent.filter((anomaly) => anomaly.severity === "low")).toHaveLength(3);
    expect(result.recommendations).toEqual([
      recommendation("REC-001"),
      recommendation("REC-002"),
    ]);
    expect(log.mock.calls.map(([message]) => message)).toEqual([
      "🤖 Groq batch 1/2 (10 anomalies)...",
      "   ✓ 1 recommendations (1 total)",
      "🤖 Groq batch 2/2 (5 anomalies)...",
      "   ✓ 1 recommendations (2 total)",
    ]);
  });

  it("retries a batch after a Groq 429", async () => {
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

  it("retries a 429 even after schema mismatches on the same batch", async () => {
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

  it("skips a batch when Groq 429 persists", async () => {
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

  it("skips a batch when failed_generation stays unreadable", async () => {
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
            description: "CPU",
          },
        ],
      }),
    ).rejects.toThrow("Échec de la génération Groq");
  });
});
