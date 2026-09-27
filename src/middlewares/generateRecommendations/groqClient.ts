import OpenAI from "openai";
import {
  BATCH_PAUSE_MS,
  getMaxRateLimitRetries,
  GROQ_SYSTEM_PROMPT,
} from "./generateRecommendations.constants";
import { buildRecommendationPrompt } from "./buildRecommendationPrompt";
import { GROQ_RESPONSE_FORMAT } from "./groqResponseFormat";
import { parseRecommendations } from "./parseGroqRecommendations";
import type { Anomaly, PartialAnalysisReport, Recommendation } from "#types/schema";

const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: process.env.GROQ_BASE_URL,
  maxRetries: 0,
});

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const getBatchPauseMs = (): number => {
  if (process.env.VITEST) return 0;
  const fromEnv = Number(process.env.GROQ_BATCH_PAUSE_MS);
  return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : BATCH_PAUSE_MS;
};

const isRateLimitError = (
  error: unknown,
): error is { status: number; message: string; headers?: Headers } =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 429;

const getErrorDetails = (error: unknown): Record<string, unknown> | undefined => {
  if (typeof error !== "object" || error === null || !("error" in error)) {
    return undefined;
  }

  const details = error.error;
  return typeof details === "object" && details !== null
    ? (details as Record<string, unknown>)
    : undefined;
};

const isSchemaValidationError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;

  if ("code" in error && error.code === "json_validate_failed") return true;

  const details = getErrorDetails(error);
  return (
    details?.code === "json_validate_failed" ||
    typeof details?.failed_generation === "string"
  );
};

const getFailedGeneration = (error: unknown): string | undefined => {
  const failedGeneration = getErrorDetails(error)?.failed_generation;
  return typeof failedGeneration === "string" && failedGeneration.length > 0
    ? failedGeneration
    : undefined;
};

const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const recoverFailedGeneration = (
  raw: string,
): Recommendation[] | undefined => {
  const parsed = parseJson(raw);
  return parsed === undefined ? undefined : parseRecommendations(parsed);
};

const getRetryDelayMs = (error: unknown): number => {
  if (!isRateLimitError(error)) return getBatchPauseMs();

  const retryAfter = error.headers?.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.ceil(seconds * 1000);
  }

  const match = error.message.match(/try again in ([\d.]+)\s*(ms|s)\b/i);
  if (match?.[1]) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return getBatchPauseMs();
    return Math.ceil(match[2]?.toLowerCase() === "ms" ? amount : amount * 1000);
  }

  return getBatchPauseMs();
};

export const requestRecommendations = async (
  insights: PartialAnalysisReport["insights"],
  anomalies: Anomaly[],
  serviceStatus: PartialAnalysisReport["service_status_summary"],
): Promise<Recommendation[]> => {
  let rateLimitAttempts = 0;
  let schemaAttempts = 0;

  while (true) {
    try {
      const response = await groq.chat.completions.create({
        model: process.env.GROQ_MODEL as string,
        messages: [
          {
            role: "system",
            content: GROQ_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: buildRecommendationPrompt(
              insights,
              anomalies,
              serviceStatus,
            ),
          },
        ],
        response_format: GROQ_RESPONSE_FORMAT,
        temperature: 0,
        max_tokens: 2048,
        top_p: 1,
        presence_penalty: 0,
        frequency_penalty: 0,
        stream: false,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("Échec de la génération Groq");

      return parseRecommendations(JSON.parse(content));
    } catch (error) {
      if (isRateLimitError(error)) {
        const maxRetries = getMaxRateLimitRetries();
        if (rateLimitAttempts < maxRetries) {
          rateLimitAttempts += 1;
          const delayMs = getRetryDelayMs(error);
          console.warn(
            `⏳ Groq 429, waiting ${delayMs}ms (${rateLimitAttempts}/${maxRetries})...`,
          );
          await sleep(delayMs);
          continue;
        }

        console.warn("⚠️ Groq 429 persisted, skipping batch");
        return [];
      }

      if (isSchemaValidationError(error)) {
        const failedGeneration = getFailedGeneration(error);
        const recovered = failedGeneration
          ? recoverFailedGeneration(failedGeneration)
          : undefined;

        if (recovered) {
          console.warn(
            "⚠️ Groq schema mismatch, recovering from failed_generation",
          );
          return recovered;
        }

        const maxRetries = getMaxRateLimitRetries();
        if (schemaAttempts < maxRetries) {
          schemaAttempts += 1;
          console.warn(
            `⚠️ Groq schema mismatch, retrying batch (${schemaAttempts}/${maxRetries})...`,
          );
          await sleep(getBatchPauseMs());
          continue;
        }

        console.warn("⚠️ Groq schema mismatch, skipping batch");
        return [];
      }

      throw error;
    }
  }
};
