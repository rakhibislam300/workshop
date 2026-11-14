import "server-only";

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

export function geminiAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function geminiModel() {
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

export async function generateWithGemini({ system, prompt, parts = [], json = false, maxOutputTokens = 700 }: { system: string; prompt: string; parts?: GeminiPart[]; json?: boolean; maxOutputTokens?: number }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini is not configured.");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }, ...parts] }],
      generationConfig: { temperature: 0, maxOutputTokens, ...(json ? { responseMimeType: "application/json" } : {}) },
    }),
  });
  const body = await response.json().catch(() => ({})) as GeminiResponse;
  if (!response.ok) throw new Error(body.error?.message || "Gemini could not complete the request.");
  const text = body.candidates?.[0]?.content?.parts?.map(part => part.text ?? "").join("").trim();
  if (!text) throw new Error(body.promptFeedback?.blockReason ? "Gemini blocked this request." : "Gemini returned no usable response.");
  return text;
}

export function parseGeminiJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text;
  return JSON.parse(fenced.trim());
}
