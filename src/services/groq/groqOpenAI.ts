import OpenAI from "openai";

/**
 * The Groq OpenAI client.
 * @returns The Groq OpenAI client.
 */
export const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: process.env.GROQ_BASE_URL,
  maxRetries: 0,
});
