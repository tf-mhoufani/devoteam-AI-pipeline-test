import type OpenAI from "openai";

/**
 * The Groq chat prompt.
 * @returns The Groq chat prompt.
 */
export type GroqChatPrompt = {
  userContent: string;
  systemPrompt: string;
};

/**
 * The Groq response format.
 * @returns The Groq response format.
 */
export type GroqResponseFormat = NonNullable<
  OpenAI.Chat.ChatCompletionCreateParams["response_format"]
>;

/**
 * The Groq structured request.
 * @param T - The type of the response.
 * @returns The Groq structured request.
 */
export type GroqStructuredRequest<T> = GroqChatPrompt & {
  responseFormat: GroqResponseFormat;
  parse: (raw: unknown) => T;
};

/**
 * The Groq retry request.
 * @param T - The type of the response.
 * @returns The Groq retry request.
 */
export type GroqRetryRequest<T> = GroqStructuredRequest<T> & {
  recoverFailedGeneration?: (raw: string) => T | undefined;
  onSkip?: () => T;
};
