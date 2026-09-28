import { parseJson } from "#helpers/parseJson";
import type { Recommendation } from "#types/schema";
import { parseRecommendations } from "./parseGroqRecommendations";

/**
 * Recovers a failed generation from the Groq API.
 * @param raw - The raw failed generation to recover.
 * @returns The recovered failed generation.
 */
export const recoverGroqFailedGeneration = (
  raw: string,
): Recommendation[] | undefined => {
  // Parse the raw failed generation
  const parsed = parseJson(raw);
  return parsed === undefined ? undefined : parseRecommendations(parsed);
};
