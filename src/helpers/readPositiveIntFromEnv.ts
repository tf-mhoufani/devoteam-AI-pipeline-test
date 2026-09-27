/**
 * Reads a positive integer from `process.env`. Falls back when the variable
 * is missing, not a number, or lower than 1.
 */
export const readPositiveIntFromEnv = (
  name: string,
  fallback: number,
): number => {
  const fromEnv = Number(process.env[name]);
  return Number.isFinite(fromEnv) && fromEnv >= 1
    ? Math.floor(fromEnv)
    : fallback;
};
