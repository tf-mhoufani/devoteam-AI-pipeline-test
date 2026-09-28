import { parseJson } from "#helpers/parseJson";
import { groq } from "./groqOpenAI";
import type { GroqStructuredRequest } from "./groqTypes";

/**
 * Creates a structured chat with the Groq API.
 * @param userContent - The user content to send to the Groq API.
 * @param systemPrompt - The system prompt to send to the Groq API.
 * @param responseFormat - The response format to send to the Groq API.
 * @param parse - The function to parse the response from the Groq API.
 * @returns The parsed response from the Groq API.
 */
export const createGroqStructuredChat = async <T>({
  userContent,
  systemPrompt,
  responseFormat,
  parse,
}: GroqStructuredRequest<T>): Promise<T> => {
  const response = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL as string,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    // response_format is used to specify the format of the response from the Groq API.
    response_format: responseFormat,
    // temperature: 0 is used to specify the temperature of the response from the Groq API.
    temperature: 0,
    // max_tokens: 2048 is used to specify the maximum number of tokens in the response from the Groq API.
    max_tokens: 2048,
    // top_p: 1 is used to specify the top p of the response from the Groq API.
    top_p: 1,
    // presence_penalty: 0 is used to specify the presence penalty of the response from the Groq API.
    presence_penalty: 0,
    // frequency_penalty: 0 is used to specify the frequency penalty of the response from the Groq API.
    frequency_penalty: 0,
    // stream: false is used to specify if the response from the Groq API should be streamed.
    stream: false,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Échec de la génération Groq");

  // parseJson is used to parse the response from the Groq API.
  const parsed = parseJson(content);
  if (parsed === undefined) throw new Error("Échec de la génération Groq");

  return parse(parsed);
};
