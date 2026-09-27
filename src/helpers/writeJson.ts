import { writeFile } from "fs/promises";
import type { z } from "zod";

interface WriteJsonOptions<T extends z.ZodType> {
  path: string;
  data: unknown;
  schema: T;
}

/**
 * Writes data to a JSON file and validates it against a Zod schema.
 */
export const writeJson = async <T extends z.ZodType>({
  path,
  data,
  schema,
}: WriteJsonOptions<T>): Promise<void> => {
  const parsed = schema.parse(data);
  await writeFile(path, JSON.stringify(parsed, null, 2));
};
