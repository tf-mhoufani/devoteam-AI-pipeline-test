export type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
};

export const consoleLogger: Logger = {
  info: (message) => {
    console.log(message);
  },
  warn: (message) => {
    console.warn(message);
  },
  error: (message, error) => {
    console.error(message, error);
  },
};

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
