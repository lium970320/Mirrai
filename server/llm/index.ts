import { ENV } from "../_core/env";
import type { LLMMessage, LLMOptions, LLMPurpose, InvokeParams } from "./types";
import { ProviderRegistry } from "./provider-registry";
import { OpenAIProvider } from "./providers/openai";
import { ClaudeProvider } from "./providers/claude";
import { OllamaProvider } from "./providers/ollama";
import { XunfeiProvider } from "./providers/xunfei";
import { DifyProvider } from "./providers/dify";
import { DEEPSEEK_FLASH_PROVIDER, DEEPSEEK_PRO_PROVIDER, resolveDeepSeekProvider } from "./deepseek-routing";
import { createLlmUsageRecord } from "../db";
import { estimateLlmInput, estimateLlmOutput, recordLlmUsage, setLlmUsagePersistentRecorder } from "./usage";

const registry = new ProviderRegistry();

registry.register(new OpenAIProvider("OpenAI", ENV.openaiApiKey, ENV.openaiBaseUrl, ENV.openaiModel, ENV.openaiSystemMessage || undefined));
registry.register(new OpenAIProvider("Kimi", ENV.kimiApiKey, ENV.kimiBaseUrl, ENV.kimiModel));
registry.register(new OpenAIProvider("Qwen", ENV.tongyiApiKey, ENV.tongyiUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1", ENV.tongyiModel));
registry.register(new OpenAIProvider("DeepSeek", ENV.deepseekApiKey, ENV.deepseekBaseUrl, ENV.deepseekModel, undefined, {
  thinking: ENV.deepseekThinking === "disabled" ? "disabled" : "enabled",
  reasoningEffort: ENV.deepseekReasoningEffort,
}));
registry.register(new OpenAIProvider(DEEPSEEK_FLASH_PROVIDER, ENV.deepseekApiKey, ENV.deepseekBaseUrl, ENV.deepseekFlashModel, undefined, {
  thinking: "disabled",
}));
registry.register(new OpenAIProvider(DEEPSEEK_PRO_PROVIDER, ENV.deepseekApiKey, ENV.deepseekBaseUrl, ENV.deepseekProModel, undefined, {
  thinking: "enabled",
  reasoningEffort: ENV.deepseekReasoningEffort,
}));
registry.register(new OpenAIProvider("Doubao", ENV.doubaoApiKey, ENV.doubaoBaseUrl, ENV.doubaoModel));
registry.register(new OpenAIProvider("302AI", ENV._302aiApiKey, "https://api.302.ai/v1", ""));
registry.register(new ClaudeProvider(ENV.claudeApiKey, ENV.claudeModel, ENV.claudeBaseUrl));
registry.register(new OllamaProvider(ENV.ollamaUrl, ENV.ollamaModel));
registry.register(new XunfeiProvider(ENV.xunfeiAppId, ENV.xunfeiApiKey, ENV.xunfeiApiSecret, ENV.xunfeiModelVersion));
registry.register(new DifyProvider(ENV.difyApiKey, ENV.difyUrl));

registry.setDefault(ENV.defaultLlmProvider);

setLlmUsagePersistentRecorder(async (record) => {
  await createLlmUsageRecord({
    startedAt: new Date(record.startedAt),
    durationMs: record.durationMs,
    provider: record.provider,
    requestedProvider: record.requestedProvider,
    model: record.model,
    purpose: record.purpose,
    userId: record.userId,
    personaId: record.personaId,
    route: record.route,
    success: record.success,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    totalTokens: record.totalTokens,
    inputChars: record.inputChars,
    outputChars: record.outputChars,
    error: record.error,
  });
});

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return /econnreset|etimedout|socket hang up|5\d{2}|rate.?limit|too many requests/.test(msg);
}

function isVersionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return /version|deprecated|unsupported.*model|model.*not found|invalid.*api/.test(msg);
}

function modelForProvider(providerName: string): string | undefined {
  switch (providerName) {
    case "OpenAI": return ENV.openaiModel;
    case "Kimi": return ENV.kimiModel;
    case "Qwen": return ENV.tongyiModel;
    case "DeepSeek": return ENV.deepseekModel;
    case DEEPSEEK_FLASH_PROVIDER: return ENV.deepseekFlashModel;
    case DEEPSEEK_PRO_PROVIDER: return ENV.deepseekProModel;
    case "Doubao": return ENV.doubaoModel;
    case "Claude": return ENV.claudeModel;
    case "Ollama": return ENV.ollamaModel;
    case "Xunfei": return ENV.xunfeiModelVersion;
    default: return undefined;
  }
}

class LLMService {
  async invoke(params: InvokeParams): Promise<string> {
    const startedAt = new Date();
    const started = Date.now();
    const providerName = resolveDeepSeekProvider(
      params.options?.provider,
      params.options?.purpose,
      ENV.defaultLlmProvider,
    );
    const provider = registry.get(providerName);
    if (!provider) {
      throw new Error(`No LLM provider available${providerName ? ` (requested: ${providerName})` : ""}. Configure at least one provider in .env`);
    }
    if (!provider.isConfigured()) {
      throw new Error(`LLM provider "${provider.name}" is not configured. Check your .env file.`);
    }

    const inputEstimate = estimateLlmInput(params.messages);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await provider.invoke(params.messages, params.options);
        const outputEstimate = estimateLlmOutput(result);
        recordLlmUsage({
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - started,
          provider: provider.name,
          requestedProvider: params.options?.provider,
          model: modelForProvider(provider.name),
          purpose: params.options?.purpose,
          userId: params.options?.userId,
          personaId: params.options?.personaId,
          route: params.options?.route,
          success: true,
          inputTokens: inputEstimate.tokens,
          outputTokens: outputEstimate.tokens,
          inputChars: inputEstimate.chars,
          outputChars: outputEstimate.chars,
        });
        return result;
      } catch (err) {
        lastError = err;
        if (isVersionError(err)) {
          console.warn(`[LLM] Provider "${provider.name}" returned a version/compatibility error:`, (err as Error).message);
          break;
        }
        if (isTransientError(err) && attempt < 2) {
          const delay = 200 * Math.pow(2, attempt);
          console.warn(`[LLM] Transient error from "${provider.name}", retrying in ${delay}ms (attempt ${attempt + 1}/3)`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        break;
      }
    }
    recordLlmUsage({
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - started,
      provider: provider.name,
      requestedProvider: params.options?.provider,
      model: modelForProvider(provider.name),
      purpose: params.options?.purpose,
      userId: params.options?.userId,
      personaId: params.options?.personaId,
      route: params.options?.route,
      success: false,
      inputTokens: inputEstimate.tokens,
      outputTokens: 0,
      inputChars: inputEstimate.chars,
      outputChars: 0,
      error: lastError instanceof Error ? lastError.message.slice(0, 300) : String(lastError).slice(0, 300),
    });
    throw lastError;
  }

  getRegistry() {
    return registry;
  }
}

export const llmService = new LLMService();
export { registry };
export type { LLMMessage, LLMOptions, LLMPurpose, InvokeParams };
