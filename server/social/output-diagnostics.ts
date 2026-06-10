import fs from "fs";
import path from "path";
import { ENV } from "../_core/env";
import { getRecentOperationsEvents, type OperationsEvent } from "../_core/operations-events";
import { getProactiveMessageConfig } from "../_core/persona-runtime";
import { isDynamicDeepSeekProvider } from "../llm/deepseek-routing";
import { buildLlmEconomyPolicy, getLlmBudgetDiagnostics } from "../llm/economy";
import { personaStickers } from "../stickers/persona-stickers";
import { getStickerReplyPolicyConfig } from "../stickers/sticker-policy";
import { getVoiceReplyPolicyConfig } from "../voice/voice-reply-policy";

type StickerTypeCount = Record<string, number>;
type RuntimeDatabaseMode = "unconfigured" | "local" | "neon" | "remote" | "invalid";
type DiagnosticTone = "ok" | "warn" | "error" | "muted";
type TroubleshootingScope = "database" | "llm" | "qq" | "wechat" | "voice" | "stickers";

const PLAN2_PERSISTENT_TABLES = [
  "personas",
  "persona_runtime_states",
  "messages",
  "memories",
  "persona_sources",
  "persona_source_chunks",
  "roleplay_channels",
  "roleplay_messages",
  "llm_usage_records",
  "wechat_bindings",
  "skill_jobs",
  "diary_entries",
] as const;

const PLAN2_EXPORT_SECTIONS = [
  "personas",
  "messages",
  "personaFiles",
  "personaSources",
  "personaSourceChunks",
  "memories",
  "emotionSnapshots",
  "diaryEntries",
  "roleplayChannels",
  "roleplayChannelMembers",
  "roleplayMessages",
  "wechatBindings",
  "skillJobs",
  "llmUsageRecords",
  "personaRuntimeStates",
  "llmConfigs",
  "wechatBotState",
  "scenes",
] as const;

const PLAN2_DELETE_SECTIONS = [
  "llmUsageRecords",
  "personaRuntimeStates",
  "memories",
  "emotionSnapshots",
  "diaryEntries",
  "roleplayMessages",
  "roleplayChannelMembers",
  "roleplayChannels",
  "messages",
  "personaFiles",
  "personaSourceChunks",
  "personaSources",
  "wechatBindings",
  "wechatBotState",
  "skillJobs",
  "llmConfigs",
  "scenes",
  "personas",
  "users",
] as const;

const PLAN2_REQUIRED_MIGRATIONS = [
  "0003_roleplay_channels.sql",
  "0004_structured_memory_cards.sql",
  "0005_qq_message_channel.sql",
  "0006_llm_usage_records.sql",
  "0007_llm_usage_attribution.sql",
  "0008_persona_runtime_states.sql",
] as const;

type PersonaDiagnosticsSource = {
  id?: number;
  name?: string;
  analysisStatus?: string;
  personaData?: unknown;
  llmProvider?: string | null;
};

export type TroubleshootingAdvice = {
  id: string;
  scope: TroubleshootingScope;
  title: string;
  detail: string;
  tone: DiagnosticTone;
  rawError?: string;
  evidence?: string;
  actions: string[];
};

function configured(value: string | undefined | null): boolean {
  return Boolean(value?.trim());
}

function preview(value: string, max = 80): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max)}...`;
}

function enabledStickerTypeCounts(): StickerTypeCount {
  return personaStickers
    .filter(sticker => sticker.enabled)
    .reduce<StickerTypeCount>((counts, sticker) => {
      counts[sticker.type] = (counts[sticker.type] ?? 0) + 1;
      return counts;
    }, {});
}

function safeEndpoint(value: string | undefined | null) {
  const raw = value?.trim();
  if (!raw) {
    return {
      configured: false,
      origin: "",
      host: "",
      port: "",
      protocol: "",
    };
  }

  try {
    const url = new URL(raw);
    return {
      configured: true,
      origin: `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`,
      host: url.hostname,
      port: url.port,
      protocol: url.protocol.replace(/:$/, ""),
    };
  } catch {
    return {
      configured: true,
      origin: "invalid-url",
      host: "",
      port: "",
      protocol: "",
    };
  }
}

function sanitizeDiagnosticError(value: unknown, max = 260): string {
  if (value == null) return "";

  let raw = "";
  if (typeof value === "string") {
    raw = value;
  } else if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    raw = [record.code, record.message, record.detail, record.reason]
      .filter(item => item != null && String(item).trim())
      .map(String)
      .join(" · ");
  } else {
    raw = String(value);
  }

  const sanitized = raw
    .replace(/\s+/g, " ")
    .replace(/\b((?:Bearer)\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/gi, "[redacted-api-key]")
    .replace(/((?:api[_-]?key|access[_-]?token|token|password|pwd|secret)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/((?:postgres(?:ql)?|https?|wss?):\/\/)([^@\s/]+)@/gi, "$1[redacted]@")
    .trim();

  if (sanitized.length <= max) return sanitized;
  return `${sanitized.slice(0, max)}...`;
}

function isHttpAuthError(message: string) {
  return /(?:\b401\b|\b403\b|unauthorized|forbidden|access[_ -]?token|authorization|鉴权|权限)/i.test(message);
}

function isNetworkError(message: string) {
  return /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|socket|connect/i.test(message);
}

function eventToTroubleshootingAdvice(event: OperationsEvent): TroubleshootingAdvice {
  return {
    id: event.id,
    scope: event.scope as TroubleshootingScope,
    title: event.title,
    detail: event.detail || "最近运行链路记录到错误，请结合本机服务日志继续排查。",
    tone: "error",
    rawError: sanitizeDiagnosticError(event.rawError),
    evidence: event.evidence || event.at,
    actions: actionsForOperationsEvent(event),
  };
}

function actionsForOperationsEvent(event: OperationsEvent): string[] {
  if (event.scope === "voice") {
    if (/asr/i.test(event.id)) {
      return [
        "确认本机 .env 已配置 ZHIPU_API_KEY 或 BIGMODEL_API_KEY。",
        "确认 ZHIPU_BASE_URL 和 ZHIPU_ASR_MODEL 与当前账号权限匹配。",
        "用同一段短语音复测，观察是否仍出现同一 ASR 错误。",
      ];
    }
    if (/voxcpm|tts/i.test(event.id)) {
      return [
        "确认 TTS provider、fallback provider 和语音参考音频配置正确。",
        "如果使用 VoxCPM，先确认 VOXCPM_SERVICE_URL 服务已启动且可访问。",
        "如果 fallback 也失败，先把 QQ_TTS_PROVIDER 临时改成 windows-sapi 或 edge 验证主链路。",
      ];
    }
    return [
      "确认 QQ 语音文件能被下载到本机。",
      "确认 ffmpeg / silk-wasm 可用，并用短语音复测。",
      "如果只影响语音输入，先保留文字降级路径验证主聊天链路。",
    ];
  }

  if (event.scope === "stickers") {
    return [
      "确认 QQ_STICKER_BASE_DIR 指向本机存在的表情包目录。",
      "确认素材文件存在、非空，且扩展名为 png / jpg / jpeg / gif / webp。",
      "如文件有效但仍发送失败，回到 NapCat / OneBot 日志检查 image 消息发送能力。",
    ];
  }

  return ["查看本机服务日志，保留 raw error 后继续细分分类。"];
}

function configuredStickerFiles(stickerBaseDir = ENV.qqStickerBaseDir) {
  return personaStickers
    .filter(sticker => sticker.enabled)
    .map(sticker => {
      const resolvedPath = path.isAbsolute(sticker.path) || /^[a-z]:[\\/]/i.test(sticker.path)
        ? path.normalize(sticker.path)
        : path.resolve(stickerBaseDir, sticker.path);
      return {
        sticker,
        resolvedPath,
        exists: fs.existsSync(resolvedPath),
      };
    });
}

function buildVoiceConfigTroubleshootingAdvice(): TroubleshootingAdvice[] {
  const items: TroubleshootingAdvice[] = [];
  const voicePolicy = getVoiceReplyPolicyConfig();
  const provider = ENV.ttsProvider.trim().toLowerCase();
  const fallbackProvider = ENV.ttsFallbackProvider.trim().toLowerCase();

  if (ENV.qqEnabled && !configured(ENV.zhipuApiKey)) {
    items.push({
      id: "voice.asr_key_missing",
      scope: "voice",
      title: "ASR key 未配置",
      detail: "QQ 语音输入已在 runtime 能力中启用，但智谱 ASR key 不存在；收到语音时只能降级成文字提示。",
      tone: "warn",
      evidence: "ZHIPU_API_KEY/BIGMODEL_API_KEY/VISION_API_KEY 未配置",
      actions: [
        "在本机运行目录 .env 配置 ZHIPU_API_KEY 或 BIGMODEL_API_KEY。",
        "确认 ZHIPU_ASR_MODEL 是当前账号可用模型。",
        "重启服务后刷新运维诊断。",
      ],
    });
  }

  if (voicePolicy.enabled && provider === "voxcpm") {
    const endpoint = safeEndpoint(ENV.voxcpmServiceUrl);
    if (!endpoint.configured || endpoint.origin === "invalid-url") {
      items.push({
        id: "voice.voxcpm_url_invalid",
        scope: "voice",
        title: "VoxCPM 地址异常",
        detail: "当前 QQ TTS provider 使用 VoxCPM，但 VOXCPM_SERVICE_URL 不是可解析地址。",
        tone: "error",
        evidence: ENV.voxcpmServiceUrl || "empty",
        actions: [
          "把 VOXCPM_SERVICE_URL 改成 http://host:port 形式。",
          "本机默认可使用 http://127.0.0.1:8818。",
          "重启 Mirrai 和 VoxCPM 服务后刷新运维诊断。",
        ],
      });
    }
    if (ENV.voxcpmCloneMode !== "none" && !configured(ENV.voxcpmReferenceAudioPath)) {
      items.push({
        id: "voice.voxcpm_reference_missing",
        scope: "voice",
        title: "VoxCPM 参考音频未配置",
        detail: "VoxCPM 当前会尝试使用克隆 / 可控语音，但没有配置默认参考音频；生成质量或服务请求可能不稳定。",
        tone: "warn",
        evidence: `cloneMode=${ENV.voxcpmCloneMode}`,
        actions: [
          "在本机 .env 配置 VOXCPM_REFERENCE_AUDIO_PATH。",
          "确认参考音频文件存在且路径不在同步盘运行产物目录。",
          "如暂时不用克隆语音，可调整 VOXCPM_CLONE_MODE 或改用 fallback TTS。",
        ],
      });
    }
  }

  if (voicePolicy.enabled && provider === "minimax" && (!configured(ENV.minimaxApiKey) || !configured(ENV.minimaxGroupId))) {
    items.push({
      id: "voice.minimax_credentials_missing",
      scope: "voice",
      title: "MiniMax TTS 凭据未配置完整",
      detail: "当前 QQ TTS provider 使用 MiniMax，但 API key 或 group id 缺失。",
      tone: "warn",
      evidence: `apiKey=${configured(ENV.minimaxApiKey)} groupId=${configured(ENV.minimaxGroupId)}`,
      actions: [
        "在本机 .env 配置 MINIMAX_API_KEY 和 MINIMAX_GROUP_ID。",
        "确认 MINIMAX_VOICE_ID 与模型可用。",
        `临时可把 QQ_TTS_FALLBACK_PROVIDER 设置为 ${fallbackProvider || "edge"} 保留语音降级。`,
      ],
    });
  }

  return items;
}

function buildStickerConfigTroubleshootingAdvice(): TroubleshootingAdvice[] {
  const policy = getStickerReplyPolicyConfig();
  if (!policy.enabled) return [];

  const files = configuredStickerFiles();
  const missing = files.filter(file => !file.exists);
  if (files.length === 0) {
    return [{
      id: "stickers.library_empty",
      scope: "stickers",
      title: "表情包素材库为空",
      detail: "表情包策略已启用，但没有启用的素材定义。",
      tone: "warn",
      evidence: "personaStickers enabled count=0",
      actions: [
        "检查 server/stickers/persona-stickers.ts 是否有 enabled=true 的素材。",
        "补齐本地素材后刷新运维诊断。",
      ],
    }];
  }

  if (missing.length > 0) {
    return [{
      id: "stickers.configured_files_missing",
      scope: "stickers",
      title: "表情包素材文件缺失",
      detail: `已启用 ${files.length} 个表情包素材，其中 ${missing.length} 个本机文件不存在。`,
      tone: "warn",
      evidence: missing.slice(0, 3).map(file => file.resolvedPath).join(" | "),
      actions: [
        "确认 QQ_STICKER_BASE_DIR 指向本机存在的素材目录。",
        "确认素材文件已同步到运行副本 F:/Code/Mirrai。",
        "如果只想临时关闭表情包，设置 QQ_STICKER_REPLY_ENABLED=false。",
      ],
    }];
  }

  return [];
}

function buildQqTroubleshootingAdvice(options: { config?: any; live?: any }): TroubleshootingAdvice | null {
  const { config, live } = options;
  const rawError = sanitizeDiagnosticError(live?.lastError);
  const status = live?.status;
  const endpoint = config?.onebotEndpoint?.origin || live?.baseUrl || "";

  if (!config?.enabled || live?.enabled === false || status === "disabled") {
    return {
      id: "qq.disabled",
      scope: "qq",
      title: "QQ 未启用",
      detail: "QQ / NapCat 入口当前关闭，不会接收 OneBot 事件。",
      tone: "muted",
      evidence: "QQ_ENABLED=false 或运行时状态为 disabled",
      actions: [
        "需要启用时，在本机运行副本 .env 设置 QQ_ENABLED=true。",
        "确认 QQ_ONEBOT_BASE_URL 指向 NapCat HTTP API。",
        "重启 Mirrai 后刷新运维诊断。",
      ],
    };
  }

  if (status === "connected") {
    return {
      id: "qq.connected",
      scope: "qq",
      title: "NapCat 已连接",
      detail: "OneBot HTTP API 可访问；如消息未进入 Mirrai，优先检查 webhook 上报地址和联系人绑定。",
      tone: "ok",
      evidence: "get_login_info 调用成功",
      actions: [
        "确认 NapCat 事件上报地址为 /api/qq/onebot/event。",
        "确认联系人已绑定到 ready 状态角色。",
      ],
    };
  }

  if (config?.onebotEndpoint?.origin === "invalid-url") {
    return {
      id: "qq.onebot_url_invalid",
      scope: "qq",
      title: "OneBot 地址格式异常",
      detail: "QQ_ONEBOT_BASE_URL 不是可解析 URL，Mirrai 无法访问 NapCat HTTP API。",
      tone: "error",
      rawError,
      evidence: endpoint || "invalid-url",
      actions: [
        "把 QQ_ONEBOT_BASE_URL 改成 http://host:port 形式。",
        "本机 NapCat 常见地址类似 http://127.0.0.1:3001。",
        "重启 Mirrai 后刷新运维诊断。",
      ],
    };
  }

  if (rawError && isHttpAuthError(rawError)) {
    return {
      id: "qq.onebot_auth_failed",
      scope: "qq",
      title: "OneBot access token 可能不匹配",
      detail: "NapCat HTTP API 返回鉴权相关错误，通常是 Mirrai 与 NapCat 的 access token 配置不一致。",
      tone: "error",
      rawError,
      evidence: endpoint,
      actions: [
        "核对 NapCat HTTP API 的 accessToken。",
        "核对本机 .env 的 QQ_ONEBOT_ACCESS_TOKEN。",
        "如果 NapCat 未启用 accessToken，Mirrai 也应留空该配置。",
      ],
    };
  }

  if (rawError && isNetworkError(rawError)) {
    return {
      id: "qq.onebot_unreachable",
      scope: "qq",
      title: "NapCat / OneBot HTTP API 不可访问",
      detail: "Mirrai 无法连接 OneBot HTTP API，QQ 消息发送、取语音文件和状态检测都会失败。",
      tone: "error",
      rawError,
      evidence: endpoint,
      actions: [
        "确认 NapCat 已启动并登录 QQ。",
        "确认 NapCat HTTP API 端口与 QQ_ONEBOT_BASE_URL 一致。",
        "在本机运行目录用浏览器或 curl 访问该端口做连通性检查。",
      ],
    };
  }

  if (rawError) {
    return {
      id: "qq.onebot_unknown_error",
      scope: "qq",
      title: "QQ 接入异常",
      detail: "OneBot 状态检测返回未分类错误，需要结合 NapCat 日志继续排查。",
      tone: "error",
      rawError,
      evidence: endpoint,
      actions: [
        "查看 NapCat 控制台最近错误。",
        "确认 Mirrai 与 NapCat 的 webhook / HTTP API 配置没有交叉写反。",
        "保留原始错误后再做更细分类。",
      ],
    };
  }

  return null;
}

function buildDatabaseTroubleshootingAdvice(database: ReturnType<typeof getDatabaseRuntimeDiagnostics>): TroubleshootingAdvice | null {
  if (database.mode === "unconfigured") {
    return {
      id: "database.unconfigured",
      scope: "database",
      title: "DATABASE_URL 未配置",
      detail: "运行诊断无法判断数据库连接目标，涉及持久化的能力可能不可用。",
      tone: "error",
      evidence: "DATABASE_URL 为空",
      actions: [
        "在本机运行目录 .env 配置 DATABASE_URL。",
        "普通开发优先使用 Neon 配置运行 corepack pnpm run dev。",
        "仅测试本机 PostgreSQL fallback 时再运行 corepack pnpm run dev:local。",
      ],
    };
  }

  if (database.mode === "invalid") {
    return {
      id: "database.invalid_url",
      scope: "database",
      title: "DATABASE_URL 格式异常",
      detail: "数据库连接串无法解析，应用启动或诊断读取可能失败。",
      tone: "error",
      evidence: "database.mode=invalid",
      actions: [
        "检查 DATABASE_URL 是否为 postgresql://user:password@host:port/database 格式。",
        "不要把引号、空格或换行写进连接串。",
        "修正后重启本机服务。",
      ],
    };
  }

  return null;
}

export function getOperationsTroubleshootingDiagnostics(options: {
  database: ReturnType<typeof getDatabaseRuntimeDiagnostics>;
  qq?: { config?: any; live?: any };
  llmUsageReadError?: unknown;
  recentEvents?: OperationsEvent[];
}) {
  const database = buildDatabaseTroubleshootingAdvice(options.database);
  const llmUsageReadError = sanitizeDiagnosticError(options.llmUsageReadError);
  const llm = llmUsageReadError
    ? {
        id: "llm.usage_database_read_failed",
        scope: "llm" as const,
        title: "LLM 用量持久化读取失败",
        detail: "运维诊断已回退到当前进程内统计；跨重启的用量、成本归属和最近调用可能不完整。",
        tone: "warn" as const,
        rawError: llmUsageReadError,
        evidence: "getPersistentLlmUsageSnapshot failed",
        actions: [
          "确认本机 DATABASE_URL 可连接。",
          "确认 llm_usage_records 已执行 0006 与 0007 迁移。",
          "本机旧库可重启服务，让 ensureLlmUsageTable 自动补表补列。",
        ],
      }
    : null;
  const qq = buildQqTroubleshootingAdvice(options.qq ?? {});
  const configItems = [
    ...buildVoiceConfigTroubleshootingAdvice(),
    ...buildStickerConfigTroubleshootingAdvice(),
  ];
  const eventItems = (options.recentEvents ?? getRecentOperationsEvents())
    .map(eventToTroubleshootingAdvice);
  const items = [database, llm, qq, ...configItems, ...eventItems].filter(
    (item): item is TroubleshootingAdvice => Boolean(item && item.tone !== "ok" && item.tone !== "muted")
  );

  return {
    summary: {
      total: items.length,
      errors: items.filter(item => item.tone === "error").length,
      warnings: items.filter(item => item.tone === "warn").length,
    },
    items,
    platforms: {
      qq,
    },
    recentEvents: (options.recentEvents ?? getRecentOperationsEvents()).map(event => ({
      ...event,
      rawError: sanitizeDiagnosticError(event.rawError),
    })),
  };
}

export function getDatabaseRuntimeDiagnostics(databaseUrl = ENV.databaseUrl) {
  const raw = databaseUrl.trim();
  if (!raw) {
    return {
      configured: false,
      mode: "unconfigured" as RuntimeDatabaseMode,
      host: "",
      port: "",
      database: "",
      sslConfigured: false,
      recommendedDevCommand: "corepack pnpm run dev",
    };
  }

  try {
    const url = new URL(raw);
    const host = url.hostname;
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    const mode: RuntimeDatabaseMode = localHosts.has(host)
      ? "local"
      : host.toLowerCase().includes("neon.tech")
        ? "neon"
        : "remote";
    const sslConfigured = Boolean(
      url.searchParams.get("sslmode")
      || url.searchParams.get("ssl")
      || url.searchParams.get("sslcert")
    );

    return {
      configured: true,
      mode,
      host,
      port: url.port,
      database: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
      sslConfigured,
      recommendedDevCommand: mode === "local" ? "corepack pnpm run dev:local" : "corepack pnpm run dev",
    };
  } catch {
    return {
      configured: true,
      mode: "invalid" as RuntimeDatabaseMode,
      host: "",
      port: "",
      database: "",
      sslConfigured: false,
      recommendedDevCommand: "corepack pnpm run dev",
    };
  }
}

function llmProviderDiagnostics() {
  return [
    {
      name: "OpenAI",
      configured: configured(ENV.openaiApiKey),
      model: ENV.openaiModel,
      endpoint: safeEndpoint(ENV.openaiBaseUrl),
    },
    {
      name: "Kimi",
      configured: configured(ENV.kimiApiKey),
      model: ENV.kimiModel,
      endpoint: safeEndpoint(ENV.kimiBaseUrl),
    },
    {
      name: "Qwen",
      configured: configured(ENV.tongyiApiKey),
      model: ENV.tongyiModel,
      endpoint: safeEndpoint(ENV.tongyiUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1"),
    },
    {
      name: "DeepSeek",
      configured: configured(ENV.deepseekApiKey),
      model: ENV.deepseekModel,
      endpoint: safeEndpoint(ENV.deepseekBaseUrl),
      thinking: ENV.deepseekThinking,
      reasoningEffort: ENV.deepseekReasoningEffort,
    },
    {
      name: "DeepSeek-Flash",
      configured: configured(ENV.deepseekApiKey),
      model: ENV.deepseekFlashModel,
      endpoint: safeEndpoint(ENV.deepseekBaseUrl),
      thinking: "disabled",
    },
    {
      name: "DeepSeek-Pro",
      configured: configured(ENV.deepseekApiKey),
      model: ENV.deepseekProModel,
      endpoint: safeEndpoint(ENV.deepseekBaseUrl),
      thinking: "enabled",
      reasoningEffort: ENV.deepseekReasoningEffort,
    },
    {
      name: "Doubao",
      configured: configured(ENV.doubaoApiKey),
      model: ENV.doubaoModel,
      endpoint: safeEndpoint(ENV.doubaoBaseUrl),
    },
    {
      name: "302AI",
      configured: configured(ENV._302aiApiKey),
      model: "",
      endpoint: safeEndpoint("https://api.302.ai/v1"),
    },
    {
      name: "Claude",
      configured: configured(ENV.claudeApiKey),
      model: ENV.claudeModel,
      endpoint: safeEndpoint(ENV.claudeBaseUrl),
    },
    {
      name: "Ollama",
      configured: configured(ENV.ollamaUrl) && configured(ENV.ollamaModel),
      model: ENV.ollamaModel,
      endpoint: safeEndpoint(ENV.ollamaUrl),
      local: true,
    },
    {
      name: "Xunfei",
      configured: configured(ENV.xunfeiAppId) && configured(ENV.xunfeiApiKey) && configured(ENV.xunfeiApiSecret),
      model: ENV.xunfeiModelVersion,
      endpoint: safeEndpoint("wss://spark-api.xf-yun.com"),
    },
    {
      name: "Dify",
      configured: configured(ENV.difyApiKey) && configured(ENV.difyUrl),
      model: "",
      endpoint: safeEndpoint(ENV.difyUrl),
    },
  ];
}

function proactiveDiagnostics(personas: PersonaDiagnosticsSource[]) {
  const configs = personas.map(persona => ({
    persona,
    config: getProactiveMessageConfig(persona.personaData),
  }));
  const enabled = configs.filter(item => item.config.enabled);
  const times = Array.from(new Set(enabled.flatMap(item => item.config.times))).sort();
  const llmProviderOverrides = configs.reduce<Record<string, number>>((counts, item) => {
    const provider = item.persona.llmProvider?.trim();
    if (provider) counts[provider] = (counts[provider] ?? 0) + 1;
    return counts;
  }, {});

  return {
    totalPersonas: personas.length,
    readyPersonas: personas.filter(persona => persona.analysisStatus === "ready").length,
    enabledPersonas: enabled.length,
    configuredSlotCount: enabled.reduce((sum, item) => sum + item.config.times.length, 0),
    uniqueTimes: times.slice(0, 12),
    additionalTimeCount: Math.max(0, times.length - 12),
    stylePromptConfiguredPersonas: enabled.filter(item => Boolean(preview(item.config.stylePrompt))).length,
    llmProviderOverrides,
  };
}

export type LlmBudgetUsageLike = {
  today?: { totalTokens?: number | null } | null;
  month?: { totalTokens?: number | null } | null;
};
export { getLlmBudgetDiagnostics } from "../llm/economy";

export function getOutputStrategyDiagnostics(personaData: unknown) {
  const voicePolicy = getVoiceReplyPolicyConfig();
  const stickerPolicy = getStickerReplyPolicyConfig();
  const proactiveConfig = getProactiveMessageConfig(personaData);
  const proactiveStylePromptPreview = preview(proactiveConfig.stylePrompt);

  return {
    qq: {
      enabled: ENV.qqEnabled,
      onebotBaseUrl: ENV.qqOnebotBaseUrl,
      accessTokenConfigured: configured(ENV.qqOnebotAccessToken),
      webhookSecretConfigured: configured(ENV.qqOnebotWebhookSecret),
      allowGroups: ENV.qqAllowGroups,
      autoBindSingleReadyPersona: ENV.qqAutoBindSingleReadyPersona,
    },
    voice: {
      policy: voicePolicy,
      asr: {
        provider: "zhipu",
        model: ENV.zhipuAsrModel,
        apiKeyConfigured: configured(ENV.zhipuApiKey),
      },
      tts: {
        provider: ENV.ttsProvider,
        fallbackProvider: ENV.ttsFallbackProvider,
        qqVoice: ENV.qqTtsVoice,
        voxcpmServiceUrl: ENV.voxcpmServiceUrl,
        voxcpmCloneMode: ENV.voxcpmCloneMode,
        voxcpmSpeechEnrichment: ENV.voxcpmSpeechEnrichment,
        voxcpmReferenceConfigured: configured(ENV.voxcpmReferenceAudioPath),
        minimaxConfigured: configured(ENV.minimaxApiKey) && configured(ENV.minimaxGroupId),
      },
    },
    stickers: {
      policy: stickerPolicy,
      baseDir: ENV.qqStickerBaseDir,
      avoidRepeatRecentCount: ENV.qqStickerReplyAvoidRepeatRecentCount,
      total: personaStickers.length,
      enabled: personaStickers.filter(sticker => sticker.enabled).length,
      enabledByType: enabledStickerTypeCounts(),
    },
    proactiveMessages: {
      enabled: proactiveConfig.enabled,
      times: proactiveConfig.times,
      configuredSlotCount: proactiveConfig.times.length,
      stylePromptConfigured: Boolean(proactiveStylePromptPreview),
      stylePromptPreview: proactiveStylePromptPreview,
    },
    platformRuntime: {
      web: { enabled: true },
      qq: {
        enabled: ENV.qqEnabled,
        text: true,
        voiceInput: true,
        voiceOutput: voicePolicy.enabled,
        stickers: stickerPolicy.enabled,
        proactiveMessages: proactiveConfig.enabled,
      },
    },
  };
}

export function getOperationsDiagnostics(options: {
  personas?: PersonaDiagnosticsSource[];
  databaseUrl?: string;
  cwd?: string;
  now?: Date;
  llmUsage?: LlmBudgetUsageLike;
} = {}) {
  const voicePolicy = getVoiceReplyPolicyConfig();
  const stickerPolicy = getStickerReplyPolicyConfig();
  const proactive = proactiveDiagnostics(options.personas ?? []);
  const generatedAt = (options.now ?? new Date()).toISOString();

  return {
    generatedAt,
    runtime: {
      nodeEnv: ENV.isProduction ? "production" : "development",
      cwd: options.cwd ?? process.cwd(),
      uploadDir: ENV.uploadDir,
      stickerBaseDir: ENV.qqStickerBaseDir,
      localWorktree: "F:/Code/Mirrai",
      localDataRoot: "F:/.mirrai-local/Mirrai",
    },
    database: getDatabaseRuntimeDiagnostics(options.databaseUrl),
    llm: {
      defaultProvider: ENV.defaultLlmProvider,
      dynamicDeepSeekRouting: isDynamicDeepSeekProvider(ENV.defaultLlmProvider),
      providers: llmProviderDiagnostics(),
      usage: {
        source: "in-memory-runtime",
        byUser: [],
        byPersona: [],
        byRoute: [],
      },
      budget: getLlmBudgetDiagnostics(options.llmUsage),
      economy: buildLlmEconomyPolicy(options.llmUsage),
    },
    qq: {
      enabled: ENV.qqEnabled,
      onebotEndpoint: safeEndpoint(ENV.qqOnebotBaseUrl),
      accessTokenConfigured: configured(ENV.qqOnebotAccessToken),
      webhookSecretConfigured: configured(ENV.qqOnebotWebhookSecret),
      allowGroups: ENV.qqAllowGroups,
      autoBindSingleReadyPersona: ENV.qqAutoBindSingleReadyPersona,
    },
    voice: {
      policy: voicePolicy,
      asr: {
        provider: "zhipu",
        model: ENV.zhipuAsrModel,
        apiKeyConfigured: configured(ENV.zhipuApiKey),
        endpoint: safeEndpoint(ENV.zhipuBaseUrl),
      },
      tts: {
        provider: ENV.ttsProvider,
        fallbackProvider: ENV.ttsFallbackProvider,
        qqVoice: ENV.qqTtsVoice,
        voxcpmEndpoint: safeEndpoint(ENV.voxcpmServiceUrl),
        voxcpmCloneMode: ENV.voxcpmCloneMode,
        voxcpmSpeechEnrichment: ENV.voxcpmSpeechEnrichment,
        voxcpmReferenceConfigured: configured(ENV.voxcpmReferenceAudioPath),
        minimaxConfigured: configured(ENV.minimaxApiKey) && configured(ENV.minimaxGroupId),
        minimaxModel: ENV.minimaxModel,
        minimaxVoiceConfigured: configured(ENV.minimaxVoiceId),
      },
    },
    stickers: {
      policy: stickerPolicy,
      baseDir: ENV.qqStickerBaseDir,
      avoidRepeatRecentCount: ENV.qqStickerReplyAvoidRepeatRecentCount,
      total: personaStickers.length,
      enabled: personaStickers.filter(sticker => sticker.enabled).length,
      enabledByType: enabledStickerTypeCounts(),
    },
    proactiveMessages: proactive,
    persistence: {
      runtimeStorage: {
        personaRuntime: "persona_runtime_states",
        llmUsage: "llm_usage_records",
        roleplay: "roleplay_channels / roleplay_messages",
        memory: "memories",
        sourceLibrary: "persona_sources / persona_source_chunks",
      },
      persistentTables: PLAN2_PERSISTENT_TABLES,
      exportSections: PLAN2_EXPORT_SECTIONS,
      deleteSections: PLAN2_DELETE_SECTIONS,
      requiredMigrations: PLAN2_REQUIRED_MIGRATIONS,
      localRuntimeCleanupScript: "scripts/cleanup-local-runtime.ps1",
      syncScript: "scripts/sync-local-worktree.ps1",
      notes: [
        "persona runtime 临时生活状态、主动消息 lastSent / ambientPresence 和 diagnostics 已从稳定画像拆到 persona_runtime_states。",
        "用户 JSON 导出不包含密码哈希、session cookie、LLM API Key、本机上传文件实体、TTS 缓存或本机数据库文件。",
        "正式 Neon / 远程 PostgreSQL 应执行 migrations；本机 helper 只用于兼容旧库补表。",
      ],
    },
    platformRuntime: {
      web: { enabled: true, text: true, media: true },
      qq: {
        enabled: ENV.qqEnabled,
        text: true,
        voiceInput: true,
        voiceOutput: voicePolicy.enabled,
        stickers: stickerPolicy.enabled,
        proactiveMessages: proactive.enabledPersonas > 0,
      },
    },
    architecture: {
      textRuntime: "server/social/persona-text-chat.ts",
      mediaRuntime: "server/social/persona-media-chat.ts",
      runtimeRequest: "server/social/runtime-request.ts",
      proactiveRuntime: "server/social/proactive-runtime.ts",
      qqBridge: "server/qq/persona-bridge.ts",
    },
  };
}
