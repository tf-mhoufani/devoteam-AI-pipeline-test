/** Parses JSON and returns `undefined` instead of throwing on invalid input. */
export const parseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};
