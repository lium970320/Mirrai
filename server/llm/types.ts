export type LLMContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; url: string };

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string | LLMContentPart[];
};

export type LLMOptions = {
  maxTokens?: number;
  temperature?: number;
  provider?: string;
  purpose?: LLMPurpose;
  userId?: number;
  personaId?: number;
  route?: string;
};

export type LLMPurpose =
  | "chat"
  | "media_reply"
  | "source_recall"
  | "roleplay"
  | "reflection"
  | "proactive"
  | "voice_policy"
  | "tts_enrichment"
  | "persona_analysis"
  | "skill_pipeline"
  | "graduation"
  | "memory_extract"
  | "diary"
  | "utility";

export type InvokeParams = {
  messages: LLMMessage[];
  options?: LLMOptions;
};

export type InvokeResult = string;

export interface LLMProvider {
  name: string;
  isConfigured(): boolean;
  invoke(messages: LLMMessage[], options?: LLMOptions): Promise<string>;
}

export function getTextContent(content: string | LLMContentPart[]): string {
  if (typeof content === "string") return content;
  return content.filter(p => p.type === "text").map(p => (p as { type: "text"; text: string }).text).join("\n");
}
