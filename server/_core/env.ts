import path from "path";

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find(value => value?.trim())?.trim() ?? "";
}

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const parsed = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",

  defaultLlmProvider: process.env.DEFAULT_LLM_PROVIDER ?? "openai",
  llmDailySoftTokenLimit: envInt("LLM_DAILY_SOFT_TOKEN_LIMIT", 0),
  llmMonthlySoftTokenLimit: envInt("LLM_MONTHLY_SOFT_TOKEN_LIMIT", 0),
  llmBudgetWarningRatio: envFloat("LLM_BUDGET_WARNING_RATIO", 0.8),

  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o",
  openaiSystemMessage: process.env.OPENAI_SYSTEM_MESSAGE ?? "",

  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  deepseekModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  deepseekFlashModel: firstNonEmpty(process.env.DEEPSEEK_FLASH_MODEL) || "deepseek-v4-flash",
  deepseekProModel: firstNonEmpty(process.env.DEEPSEEK_PRO_MODEL) || "deepseek-v4-pro",
  deepseekThinking: firstNonEmpty(process.env.DEEPSEEK_THINKING) || "enabled",
  deepseekReasoningEffort: firstNonEmpty(process.env.DEEPSEEK_REASONING_EFFORT) || "high",
  // 主聊天（chat purpose、走 Flash/非 reasoner）默认的重复/出现惩罚，抑制复读；可经 .env 调参或回滚为 0。
  chatFrequencyPenalty: envFloat("CHAT_FREQUENCY_PENALTY", 0.4),
  chatPresencePenalty: envFloat("CHAT_PRESENCE_PENALTY", 0.3),

  kimiApiKey: process.env.KIMI_API_KEY ?? "",
  kimiBaseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.cn/v1",
  kimiModel: process.env.KIMI_MODEL ?? "moonshot-v1-8k",

  claudeApiKey: process.env.CLAUDE_API_KEY ?? "",
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6",
  claudeBaseUrl: process.env.CLAUDE_BASE_URL ?? "https://api.anthropic.com",

  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3",

  difyApiKey: process.env.DIFY_API_KEY ?? "",
  difyUrl: process.env.DIFY_URL ?? "",

  xunfeiAppId: process.env.XUNFEI_APP_ID ?? "",
  xunfeiApiKey: process.env.XUNFEI_API_KEY ?? "",
  xunfeiApiSecret: process.env.XUNFEI_API_SECRET ?? "",
  xunfeiModelVersion: process.env.XUNFEI_MODEL_VERSION ?? "v3.5",

  tongyiUrl: process.env.TONGYI_URL ?? "",
  tongyiModel: process.env.TONGYI_MODEL ?? "qwen-turbo",
  tongyiApiKey: process.env.TONGYI_API_KEY ?? "",

  doubaoApiKey: process.env.DOUBAO_API_KEY ?? "",
  doubaoBaseUrl: process.env.DOUBAO_BASE_URL ?? "",
  doubaoModel: process.env.DOUBAO_MODEL ?? "",

  _302aiApiKey: process.env._302AI_API_KEY ?? "",

  visionApiKey: firstNonEmpty(process.env.VISION_API_KEY, process.env.TONGYI_API_KEY, process.env.DASHSCOPE_API_KEY),
  visionBaseUrl: firstNonEmpty(process.env.VISION_BASE_URL, process.env.TONGYI_URL) || "https://dashscope.aliyuncs.com/compatible-mode/v1",
  visionModel: firstNonEmpty(process.env.VISION_MODEL) || "qwen3-vl-flash",
  visionMaxInlineBytes: Number.parseInt(process.env.VISION_MAX_INLINE_BYTES ?? "", 10) || 7 * 1024 * 1024,

  zhipuApiKey: firstNonEmpty(process.env.ZHIPU_API_KEY, process.env.BIGMODEL_API_KEY, process.env.VISION_API_KEY),
  zhipuBaseUrl: firstNonEmpty(process.env.ZHIPU_BASE_URL, process.env.BIGMODEL_BASE_URL, process.env.VISION_BASE_URL)
    || "https://open.bigmodel.cn/api/paas/v4",
  zhipuAsrModel: firstNonEmpty(process.env.ZHIPU_ASR_MODEL) || "glm-asr-2512",

  qqEnabled: process.env.QQ_ENABLED === "true",
  qqOnebotBaseUrl: firstNonEmpty(process.env.QQ_ONEBOT_BASE_URL, process.env.ONEBOT_BASE_URL) || "http://127.0.0.1:3001",
  qqOnebotAccessToken: firstNonEmpty(process.env.QQ_ONEBOT_ACCESS_TOKEN, process.env.ONEBOT_ACCESS_TOKEN),
  qqOnebotWebhookSecret: process.env.QQ_ONEBOT_WEBHOOK_SECRET ?? "",
  qqAllowGroups: process.env.QQ_ALLOW_GROUPS === "true",
  qqAutoBindSingleReadyPersona:
    process.env.QQ_AUTO_BIND_SINGLE_READY_PERSONA !== "false",
  qqHistorySyncEnabled: process.env.QQ_HISTORY_SYNC_ENABLED !== "false",
  qqHistorySyncContacts: firstNonEmpty(process.env.QQ_HISTORY_SYNC_CONTACTS),
  qqHistorySyncIntervalSeconds: envInt("QQ_HISTORY_SYNC_INTERVAL_SECONDS", 60),
  qqHistorySyncHistoryCount: envInt("QQ_HISTORY_SYNC_HISTORY_COUNT", 20),
  qqHistorySyncMaxBackfillPerContact: envInt("QQ_HISTORY_SYNC_MAX_BACKFILL_PER_CONTACT", 6),
  qqVoiceReplyEnabled: process.env.QQ_VOICE_REPLY_ENABLED !== "false",
  qqVoiceReplyMode: firstNonEmpty(process.env.QQ_VOICE_REPLY_MODE) || "sometimes",
  qqVoiceReplyProbability: envFloat("QQ_VOICE_REPLY_PROBABILITY", 0.25),
  qqVoiceReplyOnlyWhenUserSentVoice:
    process.env.QQ_VOICE_REPLY_ONLY_WHEN_USER_SENT_VOICE !== "false",
  qqVoiceReplyMaxTextLength: envInt("QQ_VOICE_REPLY_MAX_TEXT_LENGTH", 45),
  qqVoiceReplyCooldownSeconds: envInt("QQ_VOICE_REPLY_COOLDOWN_SECONDS", 90),
  qqVoiceReplyAllowGroups: process.env.QQ_VOICE_REPLY_ALLOW_GROUPS === "true",
  qqVoiceReplySmartProvider: firstNonEmpty(process.env.QQ_VOICE_REPLY_SMART_PROVIDER),
  qqVoiceReplySmartMinConfidence: envFloat("QQ_VOICE_REPLY_SMART_MIN_CONFIDENCE", 0.68),
  qqStickerReplyEnabled: process.env.QQ_STICKER_REPLY_ENABLED !== "false",
  qqStickerReplyProbability: envFloat("QQ_STICKER_REPLY_PROBABILITY", 0.18),
  qqStickerReplyMaxReplyLength: envInt("QQ_STICKER_REPLY_MAX_REPLY_LENGTH", 90),
  qqStickerReplyCooldownSeconds: envInt("QQ_STICKER_REPLY_COOLDOWN_SECONDS", 90),
  qqStickerReplyAllowGroups: process.env.QQ_STICKER_REPLY_ALLOW_GROUPS === "true",
  qqStickerReplyAllowAfterUserSticker: process.env.QQ_STICKER_REPLY_ALLOW_AFTER_USER_STICKER !== "false",
  qqStickerReplyAllowAfterUserJoke: process.env.QQ_STICKER_REPLY_ALLOW_AFTER_USER_JOKE !== "false",
  qqStickerReplyAllowAfterUserTease: process.env.QQ_STICKER_REPLY_ALLOW_AFTER_USER_TEASE !== "false",
  qqStickerReplyAvoidRepeatRecentCount: envInt("QQ_STICKER_REPLY_AVOID_REPEAT_RECENT_COUNT", 3),
  qqStickerBaseDir: firstNonEmpty(process.env.QQ_STICKER_BASE_DIR)
    || path.join(process.cwd(), "assets", "stickers", "persona"),
  qqTtsVoice: firstNonEmpty(process.env.QQ_TTS_VOICE, process.env.TTS_VOICE) || "zh-CN-YunxiNeural",
  ttsProvider: firstNonEmpty(process.env.QQ_TTS_PROVIDER, process.env.TTS_PROVIDER)
    || (process.platform === "win32" ? "windows-sapi" : "edge"),
  ttsFallbackProvider: firstNonEmpty(process.env.QQ_TTS_FALLBACK_PROVIDER, process.env.TTS_FALLBACK_PROVIDER)
    || (process.platform === "win32" ? "windows-sapi" : "edge"),
  voxcpmServiceUrl: firstNonEmpty(process.env.VOXCPM_SERVICE_URL) || "http://127.0.0.1:8818",
  voxcpmControl: firstNonEmpty(process.env.VOXCPM_CONTROL)
    || "年轻男性，声音温和低沉，克制自然，语速中等，像近距离日常聊天",
  voxcpmCloneMode: firstNonEmpty(process.env.VOXCPM_CLONE_MODE) || "controllable",
  voxcpmReferenceAudioPath: firstNonEmpty(process.env.VOXCPM_REFERENCE_AUDIO_PATH),
  voxcpmPromptText: firstNonEmpty(process.env.VOXCPM_PROMPT_TEXT),
  voxcpmCfgValue: envFloat("VOXCPM_CFG_VALUE", 2.0),
  voxcpmInferenceSteps: envInt("VOXCPM_INFERENCE_STEPS", 10),
  voxcpmNormalize: process.env.VOXCPM_NORMALIZE === "true",
  voxcpmDenoise: process.env.VOXCPM_DENOISE === "true",
  voxcpmTimeoutMs: envInt("VOXCPM_TIMEOUT_MS", 120_000),
  voxcpmSpeechEnrichment: firstNonEmpty(process.env.VOXCPM_SPEECH_ENRICHMENT) || "local",
  voxcpmSpeechEnrichmentProvider: firstNonEmpty(process.env.VOXCPM_SPEECH_ENRICHMENT_PROVIDER),
  minimaxApiKey: firstNonEmpty(process.env.MINIMAX_API_KEY),
  minimaxGroupId: firstNonEmpty(process.env.MINIMAX_GROUP_ID),
  minimaxBaseUrl: firstNonEmpty(process.env.MINIMAX_BASE_URL) || "https://api.minimax.io/v1",
  minimaxModel: firstNonEmpty(process.env.MINIMAX_MODEL) || "speech-2.8-hd",
  minimaxVoiceId: firstNonEmpty(process.env.MINIMAX_VOICE_ID),
  minimaxLanguageBoost: firstNonEmpty(process.env.MINIMAX_LANGUAGE_BOOST) || "Chinese",
  minimaxResponseFormat: firstNonEmpty(process.env.MINIMAX_RESPONSE_FORMAT, process.env.MINIMAX_OUTPUT_FORMAT) || "hex",
  minimaxAudioFormat: firstNonEmpty(process.env.MINIMAX_AUDIO_FORMAT) || "mp3",
  minimaxSampleRate: envInt("MINIMAX_SAMPLE_RATE", 32_000),
  minimaxBitrate: envInt("MINIMAX_BITRATE", 128_000),
  minimaxChannel: envInt("MINIMAX_CHANNEL", 1),
  minimaxSpeed: envFloat("MINIMAX_SPEED", 0.95),
  minimaxVolume: envFloat("MINIMAX_VOLUME", 1),
  minimaxPitch: envInt("MINIMAX_PITCH", 0),
  minimaxEmotion: firstNonEmpty(process.env.MINIMAX_EMOTION),
  minimaxTextHumanize: process.env.MINIMAX_TEXT_HUMANIZE !== "false",
  minimaxTimeoutMs: envInt("MINIMAX_TIMEOUT_MS", 120_000),

  // 拟人行为开关：改变实时体感、默认关闭，验证后再开。
  personaReplyLatencyEnabled: process.env.PERSONA_REPLY_LATENCY_ENABLED === "true",
  proactiveMultimodalEnabled: process.env.PROACTIVE_MULTIMODAL_ENABLED === "true",

  // 人物自拍生成：经 chatgpt-project-prompt-pusher 的 --generate 入口推到网页版 ChatGPT 出图。
  // 默认关闭——开关关时自拍指令不被识别（当普通聊天），合入代码不改变现状。
  personaSelfieEnabled: process.env.PERSONA_SELFIE_ENABLED === "true",
  personaSelfiePusherProject: firstNonEmpty(process.env.PERSONA_SELFIE_PUSHER_PROJECT),
  personaSelfiePusherConfig: firstNonEmpty(process.env.PERSONA_SELFIE_PUSHER_CONFIG),
  personaSelfieBaseFacePath: firstNonEmpty(process.env.PERSONA_SELFIE_BASE_FACE_PATH),
  personaSelfieHomeRefPath: firstNonEmpty(process.env.PERSONA_SELFIE_HOME_REF_PATH),
  personaSelfieHomeDir: firstNonEmpty(process.env.PERSONA_SELFIE_HOME_DIR),
  personaSelfiePartnerFacePath: firstNonEmpty(process.env.PERSONA_SELFIE_PARTNER_FACE_PATH),
  personaSelfieTargetUrl: firstNonEmpty(process.env.PERSONA_SELFIE_TARGET_URL),
  personaSelfieProfileHint: firstNonEmpty(process.env.PERSONA_SELFIE_PROFILE_HINT) || "google-ai-persistent-profile",
  personaSelfieTimeoutMs: envInt("PERSONA_SELFIE_TIMEOUT_MS", 600_000),
  personaSelfieDotnetPath: firstNonEmpty(process.env.PERSONA_SELFIE_DOTNET_PATH) || "dotnet",

  dailyMemoryEnabled: process.env.DAILY_MEMORY_ENABLED !== "false",
  dailyMemoryHour: envInt("DAILY_MEMORY_HOUR", 3),
  dailyMemoryMinute: envInt("DAILY_MEMORY_MINUTE", 20),
  dailyMemoryIntervalMinutes: envInt("DAILY_MEMORY_INTERVAL_MINUTES", 10),
  dailyMemoryCatchUpDays: envInt("DAILY_MEMORY_CATCH_UP_DAYS", 3),
  dailyMemoryMinMessages: envInt("DAILY_MEMORY_MIN_MESSAGES", 4),
  dailyMemoryMaxChars: envInt("DAILY_MEMORY_MAX_CHARS", 8000),

  pythonPath: process.env.PYTHON_PATH ?? "python3",
  skillEngineDir: process.env.SKILL_ENGINE_DIR ?? "./skill-engine",

  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
};
