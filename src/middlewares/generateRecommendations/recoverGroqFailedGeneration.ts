import { parseJson } from "#helpers/parseJson";
import type { Recommendation } from "#types/schema";
import { parseRecommendations } from "./parseGroqRecommendations";

export const recoverGroqFailedGeneration = (
  raw: string,
): Recommendation[] | undefined => {
  const parsed = parseJson(raw);
  return parsed === undefined ? undefined : parseRecommendations(parsed);
};
