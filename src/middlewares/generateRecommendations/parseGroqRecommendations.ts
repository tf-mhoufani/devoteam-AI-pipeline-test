import { z } from "zod";
import type { Recommendation } from "#types/schema";
import { GroqParameterEntrySchema } from "./groqResponseFormat";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Structured Outputs should return `{ recommendations }`, but leftovers from
 * json_object mode (bare array, wrapped envelope, mixed invalid items) are
 * still unwrapped and filtered.
 */
const unwrapRecommendations = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) {
    const [first] = raw;
    if (isRecord(first) && "recommendations" in first && !("id" in first)) {
      return unwrapRecommendations(first);
    }
    return raw;
  }

  if (isRecord(raw) && "recommendations" in raw) {
    return unwrapRecommendations(raw.recommendations);
  }

  if (isRecord(raw) && "id" in raw) {
    return [raw];
  }

  return [];
};

const GroqRecommendationSchema = z.object({
  id: z.string(),
  action: z.string(),
  target: z.string(),
  parameters: z
    .union([
      z.record(z.string(), z.any()),
      z.array(GroqParameterEntrySchema),
    ])
    .optional()
    .default({})
    .transform((value) =>
      Array.isArray(value)
        ? Object.fromEntries(value.map(({ key, value }) => [key, value]))
        : value,
    ),
  benefit_estimate: z.string().optional().default(""),
});

export const parseRecommendations = (raw: unknown): Recommendation[] =>
  unwrapRecommendations(raw).flatMap((item) => {
    const parsed = GroqRecommendationSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
