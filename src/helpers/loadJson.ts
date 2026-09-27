import { readFile } from "fs/promises";
import type { z } from "zod";

interface LoadJsonOptions<T extends z.ZodType> {
  path: string;
  schema: T;
}

/**
 * Reads a JSON file and validates it against a Zod schema.
 */
export const loadJson = async <T extends z.ZodType>(
  { path, schema }: LoadJsonOptions<T>,
): Promise<z.infer<T>> => {
  const rawData = await readFile(path, "utf-8");
  return schema.parse(JSON.parse(rawData));
};