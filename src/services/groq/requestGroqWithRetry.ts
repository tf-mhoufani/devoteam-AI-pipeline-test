import { sleep } from "#helpers/sleep";
import { getBatchPauseMs, getMaxRetries } from "./groqConfig";
import {
  getFailedGeneration,
  getRetryDelayMs,
  isRateLimitError,
  isSchemaValidationError,
} from "./groqErrorHandling";
import { createGroqStructuredChat } from "./groqStructuredChat";
import type { GroqRetryRequest } from "./groqTypes";

/**
 * Requests the Groq API with retry.
 * @param recoverFailedGeneration - The function to recover from a failed generation.
 * @param onSkip - The function to skip the request.
 * @param request - The request to send to the Groq API.
 * @returns The response from the Groq API.
 */
export const requestGroqWithRetry = async <T>({
  recoverFailedGeneration,
  onSkip,
  ...request
}: GroqRetryRequest<T>): Promise<T> => {
  let rateLimitAttempts = 0;
  let schemaAttempts = 0;
  const maxRetries = getMaxRetries();

  while (true) {
    try {
      return await createGroqStructuredChat(request);
    } catch (error) {
      if (isRateLimitError(error)) {
        if (rateLimitAttempts < maxRetries) {
          rateLimitAttempts += 1;
          const delayMs = getRetryDelayMs(error);
          console.warn(
            `⏳ Groq 429, waiting ${delayMs}ms (${rateLimitAttempts}/${maxRetries})...`,
          );
          await sleep(delayMs);
          continue;
        }

        console.warn("⚠️ Groq 429 persisted, skipping request");
        return onSkip?.() as T;
      }

      if (isSchemaValidationError(error)) {
        const failedGeneration = getFailedGeneration(error);
        const recovered = failedGeneration
          ? recoverFailedGeneration?.(failedGeneration)
          : undefined;

        if (recovered !== undefined) {
          console.warn(
            "⚠️ Groq schema mismatch, recovering from failed_generation",
          );
          return recovered;
        }

        if (schemaAttempts < maxRetries) {
          schemaAttempts += 1;
          console.warn(
            `⚠️ Groq schema mismatch, retrying (${schemaAttempts}/${maxRetries})...`,
          );
          await sleep(getBatchPauseMs());
          continue;
        }

        console.warn("⚠️ Groq schema mismatch, skipping request");
        return onSkip?.() as T;
      }

      throw error;
    }
  }
};
