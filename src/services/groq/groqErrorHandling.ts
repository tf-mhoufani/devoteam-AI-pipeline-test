import { getBatchPauseMs } from "./groqConfig";

/**
 * Gets the error details.
 * @param error - The error to get the details from.
 * @returns The error details.
 */
const getErrorDetails = (
  error: unknown,
): Record<string, unknown> | undefined => {
  if (typeof error !== "object" || error === null || !("error" in error)) {
    return undefined;
  }

  const details = error.error;
  return typeof details === "object" && details !== null
    ? (details as Record<string, unknown>)
    : undefined;
};

/**
 * Checks if the error is a rate limit error.
 * @param error - The error to check.
 * @returns True if the error is a rate limit error, false otherwise.
 */
export const isRateLimitError = (
  error: unknown,
): error is { status: number; message: string; headers?: Headers } =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 429;

/**
 * Checks if the error is a schema validation error.
 * @param error - The error to check.
 * @returns True if the error is a schema validation error, false otherwise.
 */
export const isSchemaValidationError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;

  if ("code" in error && error.code === "json_validate_failed") return true;

  const details = getErrorDetails(error);
  return (
    details?.code === "json_validate_failed" ||
    typeof details?.failed_generation === "string"
  );
};

/**
 * Gets the failed generation.
 * @param error - The error to get the failed generation from.
 * @returns The failed generation.
 */
export const getFailedGeneration = (error: unknown): string | undefined => {
  const failedGeneration = getErrorDetails(error)?.failed_generation;
  return typeof failedGeneration === "string" && failedGeneration.length > 0
    ? failedGeneration
    : undefined;
};

/**
 * Gets the retry delay milliseconds.
 * @param error - The error to get the retry delay milliseconds from.
 * @returns The retry delay milliseconds.
 */
export const getRetryDelayMs = (error: unknown): number => {
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
