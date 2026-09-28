import type { Recommendation } from "#types/schema";
import {
  requestGroqWithRetry,
  type GroqChatPrompt,
} from "#services/groq";
import { GROQ_RESPONSE_FORMAT } from "./groqResponseFormat";
import { parseRecommendations } from "./parseGroqRecommendations";
import { recoverGroqFailedGeneration } from "./recoverGroqFailedGeneration";

export type { GroqChatPrompt as GroqPrompts };

/**
 * Requests recommendations from the Groq API.
 * @param prompts - The prompts to send to the Groq API.
 * @returns The recommendations from the Groq API.
 */
export const requestRecommendations = (
  prompts: GroqChatPrompt,
): Promise<Recommendation[]> =>
  requestGroqWithRetry({
    ...prompts,
    // responseFormat is used to specify the format of the response from the Groq API.
    responseFormat: GROQ_RESPONSE_FORMAT,
    // parse is used to parse the response from the Groq API.
    parse: parseRecommendations,
    // recoverFailedGeneration is used to recover from a failed generation.
    recoverFailedGeneration: recoverGroqFailedGeneration,
    // onSkip is used to skip the request.
    onSkip: () => [],
  });
