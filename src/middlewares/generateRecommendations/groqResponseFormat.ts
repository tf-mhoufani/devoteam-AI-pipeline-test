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

/**
 * Parameter entry schema for Groq recommendations.
 * @returns The parameter entry schema.
 */
export const GroqParameterEntrySchema = z
  .object({
    key: z.string(),
    value: z.union([
      GroqParameterPrimitiveSchema,
      z.array(GroqParameterPrimitiveSchema),
    ]),
  })
  .strict();

/**
 * Recommendation item schema for Groq recommendations.
 * @returns The recommendation item schema.
 */
export const GroqRecommendationItemSchema = z
  .object({
    id: z.string(),
    action: z.string(),
    target: z.string(),
    parameters: z.array(GroqParameterEntrySchema),
    benefit_estimate: z.string(),
  })
  .strict();

/**
 * Recommendations envelope schema for Groq recommendations.
 * @returns The recommendations envelope schema.
 */
export const GroqRecommendationsEnvelopeSchema = z
  .object({
    recommendations: z.array(GroqRecommendationItemSchema),
  })
  .strict();

/**
 * Inbound parse schema — more permissive than `GroqRecommendationItemSchema`
 * (strict outbound). Accepts key/value arrays or records and normalizes to a
 * domain-shaped recommendation.
 */
export const GroqRecommendationParseSchema = z.object({
  id: z.string(),
  action: z.string(),
  target: z.string(),
  parameters: z
    .union([z.record(z.string(), z.any()), z.array(GroqParameterEntrySchema)])
    .optional()
    .default({})
    .transform((value) =>
      Array.isArray(value)
        ? Object.fromEntries(value.map(({ key, value }) => [key, value]))
        : value,
    ),
  benefit_estimate: z.string().optional().default(""),
});

/**
 * JSON Schema for Groq recommendations.
 * @returns The JSON Schema for Groq recommendations.
 */
const groqJsonSchema = structuredClone(
  z.toJSONSchema(GroqRecommendationsEnvelopeSchema, {
    reused: "inline",
    target: "draft-07",
  }),
);
delete groqJsonSchema.$schema;

/**
 * Groq response format.
 * @returns The Groq response format.
 */
export const GROQ_RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "recommendations_envelope",
    strict: true,
    schema: groqJsonSchema,
  },
};
