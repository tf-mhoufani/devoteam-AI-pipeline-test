export type PipeStep<T> = (value: T) => T | Promise<T>;

/**
 * Applies steps left to right. Each step receives the previous output.
 * Sync and async steps are both awaited.
 */
export const pipe =
  <T>(...steps: PipeStep<T>[]) =>
  async (initial: T): Promise<T> => {
    let value = initial;

    for (const step of steps) {
      value = await step(value);
    }

    return value;
  };