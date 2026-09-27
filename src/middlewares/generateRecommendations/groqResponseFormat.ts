import { z } from "zod";

/**
 * Groq strict JSON Schema forbids open objects (`additionalProperties: true`).
 * Parameters are therefore emitted as key/value pairs, then mapped back to a
 * record after parsing.
 */
const GroqParameterPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

export const GroqParameterEntrySchema = z
  .object({
    key: z.string(),
    value: z.union([
      GroqParameterPrimitiveSchema,
      z.array(GroqParameterPrimitiveSchema),
    ]),
  })
  .strict();

export const GroqRecommendationItemSchema = z
  .object({
    id: z.string(),
    action: z.string(),
    target: z.string(),
    parameters: z.array(GroqParameterEntrySchema),
    benefit_estimate: z.string(),
  })
  .strict();

export const GroqRecommendationsEnvelopeSchema = z
  .object({
    recommendations: z.array(GroqRecommendationItemSchema),
  })
  .strict();

const groqJsonSchema = structuredClone(
  z.toJSONSchema(GroqRecommendationsEnvelopeSchema, {
    reused: "inline",
    target: "draft-07",
  }),
);
delete groqJsonSchema.$schema;

export const GROQ_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "recommendations_envelope",
    strict: true,
    schema: groqJsonSchema,
  },
};
