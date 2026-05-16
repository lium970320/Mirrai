import type { LLMMessage, LLMOptions, LLMProvider, LLMContentPart } from "../types";
import { getTextContent } from "../types";

type OpenAIProviderRequestOptions = {
  thinking?: "enabled" | "disabled";
  reasoningEffort?: string;
};

function toOpenAIContent(content: string | LLMContentPart[]): any {
  if (typeof content === "string") return content;
  return content.map(p => {
    if (p.type === "text") return { type: "text", text: p.text };
    return { type: "image_url", image_url: { url: p.url } };
  });
}

function normalizeReasoningEffort(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["xhigh", "x-high", "x_hi", "xhi", "max"].includes(normalized)) return "max";
  if (["low", "medium", "high"].includes(normalized)) return normalized;
  return value;
}

export class OpenAIProvider implements LLMProvider {
  constructor(
    public name: string,
    private apiKey: string,
    private baseUrl: string,
    private model: string,
    private systemMessage?: string,
    private requestOptions: OpenAIProviderRequestOptions = {},
  ) {}

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string> {
    const allMessages = this.systemMessage
      ? [{ role: "system" as const, content: this.systemMessage }, ...messages]
      : messages;

    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: allMessages.map(m => ({ role: m.role, content: toOpenAIContent(m.content) })),
      max_tokens: options?.maxTokens ?? 4096,
    };

    if (this.requestOptions.thinking) {
      body.extra_body = { thinking: { type: this.requestOptions.thinking } };
      const reasoningEffort = normalizeReasoningEffort(this.requestOptions.reasoningEffort);
      if (reasoningEffort) body.reasoning_effort = reasoningEffort;
      if (this.requestOptions.thinking === "disabled") {
        body.temperature = options?.temperature ?? 0.7;
      }
    } else {
      body.temperature = options?.temperature ?? 0.7;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`[${this.name}] LLM error ${response.status}: ${err}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  }
}
