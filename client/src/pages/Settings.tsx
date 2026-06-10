import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Wifi, WifiOff, Settings2, Sliders, ChevronDown, ChevronUp, Check,
  User, Shield, Database, Download, Trash2, KeyRound, Mail, Calendar,
  MessageCircle, FileText, HardDrive, Users, Clock, Pencil, AlertTriangle,
  Leaf, Eye, EyeOff, Activity, Server, Cpu, Volume2, ImageIcon, Radio,
  RefreshCw, Terminal,
} from "lucide-react";
import { toast } from "sonner";

// ─── TAB CONFIG ──────────────────────────────────────────────────────────────

const TABS = [
  { key: "profile", label: "个人资料", icon: User },
  { key: "ai", label: "AI 设置", icon: Settings2 },
  { key: "wechat", label: "微信", icon: Wifi },
  { key: "qq", label: "QQ", icon: MessageCircle },
  { key: "diagnostics", label: "运维诊断", icon: Activity },
  { key: "data", label: "数据管理", icon: Database },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ─── SLIDER FIELD ────────────────────────────────────────────────────────────

function SliderField({ label, value, onChange, min, max, step, unit }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; unit?: string;
}) {
  return (
    <div className="space-y-3 p-4 bg-muted/20 border border-border/30 rounded-xl">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold text-foreground/90">{label}</Label>
        <span className="text-sm font-bold text-primary bg-primary/8 px-2.5 py-0.5 rounded-full">{value}{unit}</span>
      </div>
// ─── SLIDER_PLACEHOLDER ──────────────────────────────────────────────────────
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary" />
      <div className="flex justify-between text-[11px] text-muted-foreground/80 font-medium px-0.5">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ─── PROVIDER CONFIG ROW ─────────────────────────────────────────────────────

function ProviderConfigRow({ provider, onSave, onSetDefault }: {
  provider: { name: string; configured: boolean };
  onSave: (data: { providerName: string; apiKey?: string; baseUrl?: string; model?: string }) => void;
  onSetDefault: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");

  return (
    <div className={`rounded-xl overflow-hidden ${provider.configured ? "provider-card-configured" : "provider-card-unconfigured"}`}>
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3.5 hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-2.5">
          <div className={`w-1.5 h-1.5 rounded-full ${provider.configured ? "bg-emerald-500" : "bg-muted-foreground/45"}`} />
          <span className="text-sm text-foreground font-semibold tracking-tight">{provider.name}</span>
          <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${provider.configured ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
            {provider.configured ? "已配置" : "未配置"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span onClick={e => { e.stopPropagation(); onSetDefault(); }}
            className="text-xs text-primary hover:underline cursor-pointer font-medium">设为默认</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground/80" /> : <ChevronDown className="w-4 h-4 text-muted-foreground/80" />}
        </div>
      </button>
      {expanded && (
        <div className="p-3.5 pt-0 space-y-3.5 border-t border-border/40">
          <div>
            <Label className="text-xs font-medium text-foreground/70">API Key</Label>
            <Input value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..." type="password" className="h-9 bg-muted/35 border-border/50 rounded-lg text-sm mt-1" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <Label className="text-xs font-medium text-foreground/70">Base URL (可选)</Label>
              <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1" className="h-9 bg-muted/35 border-border/50 rounded-lg text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs font-medium text-foreground/70">Model (可选)</Label>
              <Input value={model} onChange={e => setModel(e.target.value)}
                placeholder="gpt-4o" className="h-9 bg-muted/35 border-border/50 rounded-lg text-sm mt-1" />
            </div>
          </div>
          <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg h-8.5 font-semibold text-xs px-3"
            onClick={() => {
              onSave({ providerName: provider.name, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined, model: model || undefined });
              setExpanded(false);
            }}>
            <Check className="w-3.5 h-3.5 mr-1" />保存配置
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── STAT ITEM ───────────────────────────────────────────────────────────────

function StatItem({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-muted/20 rounded-xl">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-primary/70" />
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

// ─── DIAGNOSTIC PRIMITIVES ───────────────────────────────────────────────────

type StatusTone = "ok" | "warn" | "error" | "muted";
type DiagnosticAdvice = {
  id?: string;
  scope?: string;
  title: string;
  detail: string;
  tone: StatusTone;
  rawError?: string;
  evidence?: string;
  actions?: string[];
};

const toneClasses: Record<StatusTone, string> = {
  ok: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "bg-red-500/10 text-red-700 dark:text-red-300",
  muted: "bg-muted text-muted-foreground",
};

function toneForEnabled(value: boolean): StatusTone {
  return value ? "ok" : "muted";
}

function StatusBadge({ label, tone = "muted" }: { label: string; tone?: StatusTone }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}

function BoolBadge({ value, trueLabel = "已配置", falseLabel = "未配置" }: {
  value: boolean;
  trueLabel?: string;
  falseLabel?: string;
}) {
  return <StatusBadge label={value ? trueLabel : falseLabel} tone={toneForEnabled(value)} />;
}

function DiagnosticCard({ icon: Icon, title, subtitle, action, children }: {
  icon: any;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="warm-card p-5 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon className="w-4.5 h-4.5 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-foreground">{title}</h2>
            {subtitle && <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function DiagnosticRow({ label, value, mono = false, badge }: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  badge?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-t border-border/50 py-2.5 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`min-w-0 text-sm text-foreground sm:text-right ${mono ? "font-mono text-xs break-all" : "break-words"}`}>
        {badge ?? value}
      </span>
    </div>
  );
}

function compactList(items: string[] | undefined, empty = "无") {
  if (!items || items.length === 0) return empty;
  return items.join("、");
}

function formatDiagnosticTime(value: string | undefined) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function platformStatusLabel(platform: "qq" | "wechat", status: string | undefined) {
  if (platform === "qq") {
    const labels: Record<string, string> = {
      connected: "已连接",
      error: "连接异常",
      disabled: "未启用",
      unknown: "未知",
    };
    return labels[status || "unknown"] || status || "未知";
  }

  const labels: Record<string, string> = {
    logged_in: "已登录",
    starting: "启动中",
    scanning: "等待扫码",
    stopped: "未启动",
    error: "运行异常",
    unknown: "未知",
  };
  return labels[status || "unknown"] || status || "未知";
}

function runtimeCapabilityLabel(key: string) {
  const labels: Record<string, string> = {
    text: "文本",
    media: "媒体",
    voiceInput: "语音输入",
    voiceOutput: "语音输出",
    stickers: "表情包",
    proactiveMessages: "主动消息",
    autoBindSingleReadyPersona: "自动绑定单角色",
  };
  return labels[key] || key;
}

function voiceModeLabel(mode: string | undefined) {
  const labels: Record<string, string> = {
    never: "永不发语音",
    requested: "仅明确要求",
    smart: "智能判定",
    sometimes: "低频自然发送",
    always: "总是语音",
  };
  return labels[mode || ""] || mode || "未知";
}

function ttsProviderLabel(provider: string | undefined) {
  const labels: Record<string, string> = {
    "windows-sapi": "Windows SAPI",
    edge: "Edge TTS",
    voxcpm: "VoxCPM",
    minimax: "MiniMax",
    none: "无降级",
  };
  return labels[provider || ""] || provider || "未知";
}

function llmUsageSourceLabel(source: string | undefined) {
  const labels: Record<string, string> = {
    database: "数据库持久化",
    "in-memory-runtime": "当前进程内",
  };
  return labels[source || ""] || source || "未知";
}

function llmBudgetStatusLabel(status: string | undefined) {
  const labels: Record<string, string> = {
    disabled: "未配置",
    ok: "额度内",
    warn: "接近上限",
    exceeded: "已超额",
  };
  return labels[status || ""] || status || "未知";
}

function llmBudgetTone(status: string | undefined): StatusTone {
  if (status === "exceeded") return "error";
  if (status === "warn") return "warn";
  if (status === "ok") return "ok";
  return "muted";
}

function llmEconomyLevelLabel(level: string | undefined) {
  const labels: Record<string, string> = {
    off: "未启用",
    conservative: "保守",
    strict: "严格",
  };
  return labels[level || ""] || level || "未知";
}

function llmEconomyTone(level: string | undefined): StatusTone {
  if (level === "strict") return "error";
  if (level === "conservative") return "warn";
  return "muted";
}

function tokenBudgetText(item: any) {
  const limit = Number(item?.limit ?? 0);
  const used = Number(item?.used ?? 0);
  if (!limit) return "未配置";
  return `${used} / ${limit} tokens · 剩余 ${item?.remaining ?? 0}`;
}

function llmEconomyActionText(economy: any) {
  if (!economy?.enabled) return "未执行自动降成本";
  const actions = [
    economy.voice?.allowSmartJudge === false ? "暂停语音智能判断" : "",
    economy.tts?.allowLlmSpeechEnrichment === false ? "暂停 TTS LLM 润色" : "",
    economy.proactive?.allowScheduled === false ? "暂停定时主动消息" : "",
    economy.proactive?.allowAmbient === false ? "暂停环境主动消息" : "",
  ].filter(Boolean);
  return actions.length ? actions.join("、") : "保留当前链路";
}

function llmEconomyLimitText(summary: any, kind: "context" | "memory" | "source") {
  if (!summary) return "暂无";
  if (kind === "context") {
    const context = summary.context ?? {};
    return `读取 ${context.historyFetchLimit ?? "-"} 条 · 进 LLM ${context.llmHistoryLimit ?? "-"} 条 · 连续性 ${context.continuityRecentLimit ?? "-"} 条`;
  }
  if (kind === "memory") {
    const memory = summary.memoryRecall ?? {};
    return `${memory.maxMemories ?? "-"} 条 · 每条 ${memory.maxDescriptionChars ?? "-"} 字`;
  }
  const source = summary.sourceRecall ?? {};
  return `${source.maxChunks ?? "-"} 段 · 摘录 ${source.maxExcerptChars ?? "-"} 字 · 改写 ${source.maxRewriteTokens ?? "-"} tokens`;
}

function llmUsageBucketText(items: any[] | undefined, key: string, empty = "暂无") {
  const list = (items ?? []).slice(0, 4)
    .map(item => {
      const rawName = item?.[key] ?? item?.name ?? "未归属";
      const name = rawName === null || rawName === "" ? "未归属" : String(rawName);
      return `${name} ${item?.totalTokens ?? 0}`;
    });
  return list.length ? list.join("、") : empty;
}

function parseOptionalIntegerInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseUsageLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 200);
}

function optionalUsageText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function usageErrorPreview(value: string | undefined) {
  if (!value) return "";
  return value.length > 120 ? `${value.slice(0, 120)}...` : value;
}

function usageRecordMeta(record: any) {
  const parts = [
    record?.purpose || "unknown",
    record?.route || "unknown",
    record?.userId == null ? "未归属用户" : `用户 #${record.userId}`,
    record?.personaId == null ? "未归属角色" : `角色 #${record.personaId}`,
  ];
  return parts.join(" · ");
}

function platformDiagnosticAdvice(platform: "qq" | "wechat", status: any): DiagnosticAdvice | null {
  const raw = platform === "wechat"
    ? status?.lastError?.message || status?.lastError?.code || ""
    : status?.lastError || "";
  const message = String(raw || "").trim();

  if (platform === "qq") {
    if (!status?.enabled || status?.status === "disabled") {
      return {
        title: "QQ 未启用",
        detail: "在本机运行副本 .env 设置 QQ_ENABLED=true，重启 Mirrai 后再检查 NapCat。",
        tone: "muted",
      };
    }
    if (status?.status === "connected") {
      return {
        title: "NapCat 已连接",
        detail: "OneBot HTTP API 可访问，后续重点检查联系人绑定和 webhook 上报。",
        tone: "ok",
      };
    }
    if (/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(message)) {
      return {
        title: "NapCat / OneBot 不可访问",
        detail: "确认 NapCat 已启动，HTTP API 端口与 QQ_ONEBOT_BASE_URL 一致，并允许本机访问。",
        tone: "error",
      };
    }
    if (/401|403|unauthorized|token|access/i.test(message)) {
      return {
        title: "OneBot access token 可能不匹配",
        detail: "核对 NapCat accessToken 与 QQ_ONEBOT_ACCESS_TOKEN；事件上报 token 另看 webhook token。",
        tone: "error",
      };
    }
    if (message) {
      return {
        title: "QQ 接入异常",
        detail: message,
        tone: "error",
      };
    }
  }

  if (platform === "wechat") {
    if (!status || status.status === "stopped") {
      return {
        title: "微信机器人未启动",
        detail: "需要使用微信页签启动服务；微信 Web 登录稳定性受账号和环境影响。",
        tone: "muted",
      };
    }
    if (status.status === "logged_in") {
      return {
        title: "微信已登录",
        detail: "微信收发可用，后续重点检查联系人绑定和主动消息策略。",
        tone: "ok",
      };
    }
    if (status.syncCircuitBreakerTripped || /400|熔断|停止自动重试|login/i.test(message)) {
      return {
        title: "微信 Web 登录已熔断",
        detail: "当前账号或环境可能无法获取扫码会话；先在微信页签停止服务，再确认 puppet / 登录态后重试。",
        tone: "error",
      };
    }
    if (status.status === "starting" || status.status === "scanning") {
      return {
        title: platformStatusLabel("wechat", status.status),
        detail: "等待服务进入已登录状态；扫码二维码后再刷新诊断。",
        tone: "warn",
      };
    }
    if (message) {
      return {
        title: "微信接入异常",
        detail: message,
        tone: "error",
      };
    }
  }

  return null;
}

function AdvisoryBox({ advice }: { advice: DiagnosticAdvice | null }) {
  if (!advice) return null;
  const borderClasses: Record<StatusTone, string> = {
    ok: "border-emerald-500/20 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200",
    warn: "border-amber-500/20 bg-amber-500/5 text-amber-800 dark:text-amber-200",
    error: "border-red-500/20 bg-red-500/5 text-red-800 dark:text-red-200",
    muted: "border-border/60 bg-muted/10 text-muted-foreground",
  };
  return (
    <div className={`mt-3 rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${borderClasses[advice.tone]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{advice.title}</span>
        {advice.scope && <span className="rounded-full bg-background/55 px-1.5 py-0.5 font-mono text-[10px] uppercase">{advice.scope}</span>}
      </div>
      <div className="mt-1 break-words">{advice.detail}</div>
      {advice.rawError && (
        <div className="mt-2 rounded-md bg-background/45 px-2 py-1.5 font-mono text-[11px] break-all">
          {advice.rawError}
        </div>
      )}
      {advice.actions && advice.actions.length > 0 && (
        <ul className="mt-2 space-y-1">
          {advice.actions.map((action, index) => (
            <li key={`${advice.id ?? advice.title}-${index}`} className="break-words">
              {index + 1}. {action}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── PROFILE TAB ─────────────────────────────────────────────────────────────

function ProfileTab() {
  const { data: profile, refetch } = trpc.user.getProfile.useQuery();
  const { data: accountStats } = trpc.user.getAccountStats.useQuery();
  const updateProfile = trpc.user.updateProfile.useMutation({
    onSuccess: () => { toast.success("资料已更新"); refetch(); setEditing(false); },
    onError: (e: any) => toast.error(e.message),
  });
  const changePassword = trpc.user.changePassword.useMutation({
    onSuccess: () => { toast.success("密码已修改"); setShowPasswordDialog(false); setCurrentPwd(""); setNewPwd(""); setConfirmPwd(""); },
    onError: (e: any) => toast.error(e.message),
  });

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);

  useEffect(() => {
    if (profile) {
      setEditName(profile.name || "");
      setEditEmail(profile.email || "");
    }
  }, [profile]);

  if (!profile) return <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>;

  const memberDays = Math.max(1, Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / 86400000));

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6">
      {/* Avatar + Basic Info */}
      <div className="warm-card p-6">
        <div className="flex items-start gap-5">
          <div className="relative">
            <div className="w-20 h-20 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center">
              <span className="text-3xl font-bold text-primary">{(profile.name || profile.username).charAt(0).toUpperCase()}</span>
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-card flex items-center justify-center">
              <Check className="w-3 h-3 text-white" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">昵称</Label>
                  <Input value={editName} onChange={e => setEditName(e.target.value)}
                    className="h-9 bg-muted/50 border-border rounded-xl text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">邮箱</Label>
                  <Input value={editEmail} onChange={e => setEditEmail(e.target.value)}
                    type="email" placeholder="your@email.com"
                    className="h-9 bg-muted/50 border-border rounded-xl text-sm mt-1" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
                    onClick={() => updateProfile.mutate({ name: editName.trim() || undefined, email: editEmail.trim() || undefined })}
                    disabled={updateProfile.isPending}>
                    {updateProfile.isPending ? "保存中..." : "保存"}
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setEditing(false)}>取消</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-lg font-semibold text-foreground">{profile.name || profile.username}</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{profile.role}</span>
                </div>
                <p className="text-sm text-muted-foreground">@{profile.username}</p>
                {profile.email && (
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                    <Mail className="w-3 h-3" /> {profile.email}
                  </div>
                )}
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> 加入 {memberDays} 天
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> 上次登录 {new Date(profile.lastSignedIn).toLocaleDateString("zh-CN")}
                  </span>
                </div>
                <Button size="sm" variant="ghost" className="mt-3 text-xs text-primary hover:text-primary/80 rounded-xl h-7 px-2"
                  onClick={() => setEditing(true)}>
                  <Pencil className="w-3 h-3 mr-1" /> 编辑资料
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Account Stats */}
      {accountStats && (
        <div className="warm-card p-5">
          <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
            <Database className="w-4 h-4 text-primary/60" /> 账户统计
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatItem icon={Users} label="数字分身" value={accountStats.totalPersonas} />
            <StatItem icon={MessageCircle} label="总对话次数" value={accountStats.totalChats} />
            <StatItem icon={MessageCircle} label="总消息数" value={accountStats.totalMessages} />
            <StatItem icon={FileText} label="上传文件" value={accountStats.totalFiles} />
            <StatItem icon={HardDrive} label="存储空间" value={formatBytes(accountStats.storageUsed)} />
            <StatItem icon={Calendar} label="使用天数" value={memberDays} />
          </div>
        </div>
      )}

      {/* Security */}
      <div className="warm-card p-5">
        <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary/60" /> 安全设置
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-muted/20 rounded-xl">
            <div className="flex items-center gap-3">
              <KeyRound className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-foreground">登录密码</p>
                <p className="text-xs text-muted-foreground">定期修改密码以保护账户安全</p>
              </div>
            </div>
            <Button size="sm" variant="outline" className="rounded-xl text-xs border-border"
              onClick={() => setShowPasswordDialog(true)}>
              修改密码
            </Button>
          </div>
          {profile.loginMethod && (
            <div className="flex items-center gap-3 p-3 bg-muted/20 rounded-xl">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-foreground">登录方式</p>
                <p className="text-xs text-muted-foreground">{profile.loginMethod}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="bg-card border-border rounded-2xl max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">修改密码</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">当前密码</Label>
              <div className="relative">
                <Input value={currentPwd} onChange={e => setCurrentPwd(e.target.value)}
                  type={showCurrentPwd ? "text" : "password"} placeholder="输入当前密码"
                  className="h-10 bg-muted/50 border-border rounded-xl pr-10" />
                <button onClick={() => setShowCurrentPwd(!showCurrentPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">新密码</Label>
              <div className="relative">
                <Input value={newPwd} onChange={e => setNewPwd(e.target.value)}
                  type={showNewPwd ? "text" : "password"} placeholder="至少 6 位"
                  className="h-10 bg-muted/50 border-border rounded-xl pr-10" />
                <button onClick={() => setShowNewPwd(!showNewPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {newPwd && newPwd.length < 6 && (
                <p className="text-xs text-destructive">密码至少需要 6 个字符</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">确认新密码</Label>
              <Input value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                type="password" placeholder="再次输入新密码"
                className="h-10 bg-muted/50 border-border rounded-xl" />
              {confirmPwd && confirmPwd !== newPwd && (
                <p className="text-xs text-destructive">两次输入的密码不一致</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowPasswordDialog(false)} className="rounded-xl">取消</Button>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
              disabled={!currentPwd || newPwd.length < 6 || newPwd !== confirmPwd || changePassword.isPending}
              onClick={() => changePassword.mutate({ currentPassword: currentPwd, newPassword: newPwd })}>
              {changePassword.isPending ? "修改中..." : "确认修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── AI SETTINGS TAB ─────────────────────────────────────────────────────────

function AISettingsTab() {
  const providers = trpc.llmConfig.listProviders.useQuery();
  const defaultConfig = trpc.llmConfig.getDefault.useQuery();
  const upsertConfig = trpc.llmConfig.upsert.useMutation({
    onSuccess: () => { toast.success("配置已保存"); providers.refetch(); },
  });
  const setDefault = trpc.llmConfig.setDefault.useMutation({
    onSuccess: () => { toast.success("默认提供商已更新"); defaultConfig.refetch(); },
  });
  const updateExtra = trpc.llmConfig.updateExtraConfig.useMutation({
    onSuccess: () => { toast.success("对话参数已保存"); defaultConfig.refetch(); },
  });

  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [contextLimit, setContextLimit] = useState(20);

  useEffect(() => {
    if (defaultConfig.data?.extraConfig) {
      const e = defaultConfig.data.extraConfig as any;
      if (e.temperature != null) setTemperature(e.temperature);
      if (e.maxTokens != null) setMaxTokens(e.maxTokens);
      if (e.contextLimit != null) setContextLimit(e.contextLimit);
    }
  }, [defaultConfig.data]);

  return (
    <div className="space-y-6">
      <section className="warm-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">AI 提供商</h2>
          {defaultConfig.data && (
            <span className="text-xs text-muted-foreground ml-auto">
              当前默认: <span className="text-primary font-medium">{defaultConfig.data.providerName}</span>
            </span>
          )}
        </div>
        <div className="space-y-2">
          {providers.data?.map(p => (
            <ProviderConfigRow key={p.name} provider={p}
              onSave={data => upsertConfig.mutate(data)}
              onSetDefault={() => setDefault.mutate({ providerName: p.name })} />
          ))}
        </div>
      </section>

      <section className="warm-card p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">对话参数</h2>
        </div>
        <SliderField label="Temperature（创造性）" value={temperature} onChange={setTemperature}
          min={0} max={2} step={0.1} />
        <SliderField label="Max Tokens（最大回复长度）" value={maxTokens} onChange={setMaxTokens}
          min={256} max={8192} step={256} />
        <SliderField label="上下文消息数" value={contextLimit} onChange={setContextLimit}
          min={5} max={50} step={5} unit=" 条" />
        <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
          onClick={() => updateExtra.mutate({ extraConfig: { temperature, maxTokens, contextLimit } })}
          disabled={updateExtra.isPending}>
          {updateExtra.isPending ? "保存中..." : "保存参数"}
        </Button>
      </section>
    </div>
  );
}

// ─── WECHAT TAB ──────────────────────────────────────────────────────────────

function WeChatTab() {
  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const wechatStatus = trpc.wechat.getStatus.useQuery(undefined, { refetchInterval: 3000 });
  const recentContacts = trpc.wechat.recentContacts.useQuery(undefined, { refetchInterval: 3000 });
  const bindings = trpc.wechat.listBindings.useQuery(undefined, { refetchInterval: 3000 });
  const personas = trpc.persona.list.useQuery();
  const bot = wechatStatus.data;
  const readyPersonas = useMemo(
    () => (personas.data ?? []).filter((p: any) => p.analysisStatus === "ready"),
    [personas.data],
  );
  const personaById = useMemo(
    () => new Map((personas.data ?? []).map((p: any) => [p.id, p])),
    [personas.data],
  );
  const bindingByContactId = useMemo(
    () => new Map((bindings.data ?? []).map((b: any) => [b.wechatContactId, b])),
    [bindings.data],
  );

  useEffect(() => {
    if (!selectedPersonaId && readyPersonas.length > 0) {
      setSelectedPersonaId(String(readyPersonas[0].id));
    }
  }, [readyPersonas, selectedPersonaId]);

  const startBot = trpc.wechat.start.useMutation({
    onSuccess: () => { toast.success("微信机器人启动中..."); wechatStatus.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const stopBot = trpc.wechat.stop.useMutation({
    onSuccess: () => { toast.success("微信机器人已停止"); wechatStatus.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const bindContact = trpc.wechat.bindContact.useMutation({
    onSuccess: () => { toast.success("微信联系人已绑定"); bindings.refetch(); personas.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const unbindContact = trpc.wechat.unbindContact.useMutation({
    onSuccess: () => { toast.success("已解除绑定"); bindings.refetch(); personas.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleBind = (contact: { id: string; name: string }) => {
    const personaId = Number(selectedPersonaId);
    if (!personaId) {
      toast.error("请先选择分身");
      return;
    }
    bindContact.mutate({
      personaId,
      wechatContactId: contact.id,
      wechatName: contact.name,
    });
  };

  return (
    <div className="space-y-6">
      <section className="warm-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          {bot?.status === "logged_in"
            ? <Wifi className="w-5 h-5 text-emerald-500" />
            : <WifiOff className="w-5 h-5 text-muted-foreground" />}
          <h2 className="font-semibold text-foreground">微信机器人</h2>
          <span className="text-sm text-muted-foreground ml-auto">
            {bot?.status === "logged_in" && `已登录: ${bot.loggedInUser}`}
            {bot?.status === "starting" && "启动中..."}
            {bot?.status === "scanning" && "等待扫码..."}
            {bot?.status === "stopped" && "未启动"}
            {bot?.status === "error" && (bot.syncCircuitBreakerTripped ? "已熔断" : "出错")}
          </span>
        </div>

        <div className="p-4 bg-muted/20 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-3 h-3 rounded-full ${
              bot?.status === "logged_in" ? "bg-emerald-500" :
              bot?.status === "starting" ? "bg-amber-400 animate-pulse" :
              bot?.status === "scanning" ? "bg-blue-400 animate-pulse" :
              bot?.status === "error" ? "bg-red-400" : "bg-muted-foreground/30"
            }`} />
            <span className="text-sm text-foreground font-medium">
              {bot?.status === "logged_in" ? "在线运行中" :
               bot?.status === "starting" ? "启动中" :
               bot?.status === "scanning" ? "等待扫码登录" :
               bot?.status === "error" ? (bot.syncCircuitBreakerTripped ? "同步异常，已停止自动重试" : "运行出错") : "未启动"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            启动微信机器人后，绑定的分身可以通过微信自动回复消息。扫码登录你的微信账号即可开始使用。
          </p>
          {bot?.lastError && (
            <p className="mt-3 text-xs text-red-500 leading-relaxed">
              {bot.lastError.message}
            </p>
          )}
        </div>

        {bot?.qrCodeUrl && (
          <div className="flex flex-col items-center gap-3 py-4">
            <img src={bot.qrCodeUrl} alt="WeChat QR" className="w-48 h-48 rounded-xl border border-border" />
            <p className="text-xs text-muted-foreground">请使用微信扫描二维码登录</p>
          </div>
        )}

        <div className="flex gap-2.5">
          <Button size="sm" className="bg-primary hover:bg-primary/95 text-primary-foreground rounded-xl shadow-xs hover:shadow-md active:scale-[0.98] transition-all"
            onClick={() => startBot.mutate()}
            disabled={startBot.isPending || bot?.status === "logged_in" || bot?.status === "starting" || bot?.status === "scanning"}>
            启动服务
          </Button>
          <Button size="sm" variant="outline" className="rounded-xl border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 active:scale-[0.98] transition-all"
            onClick={() => stopBot.mutate()} disabled={stopBot.isPending || bot?.status === "stopped"}>
            停止服务
          </Button>
        </div>
      </section>

      <section className="warm-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary/70" />
          <h2 className="font-semibold text-foreground">联系人绑定</h2>
          <span className="text-sm text-muted-foreground ml-auto">{bindings.data?.length ?? 0} 个已绑定</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3">
          <div className="space-y-2">
            <Label className="text-xs text-foreground/70">选择分身</Label>
            <select value={selectedPersonaId} onChange={e => setSelectedPersonaId(e.target.value)}
              className="w-full h-10 px-3 bg-muted/50 border border-border rounded-lg text-sm text-foreground">
              {readyPersonas.length === 0 && <option value="">暂无可绑定分身</option>}
              {readyPersonas.map((persona: any) => (
                <option key={persona.id} value={persona.id}>{persona.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-foreground/70">最近私聊联系人</Label>
            <div className="space-y-2">
              {(recentContacts.data ?? []).length === 0 && (
                <div className="p-3 bg-muted/20 rounded-lg text-sm text-muted-foreground">
                  暂无联系人。扫码登录后，让要绑定的微信先发一条私聊消息。
                </div>
              )}

              {(recentContacts.data ?? []).map((contact: any) => {
                const binding = bindingByContactId.get(contact.id) as any;
                const boundPersona = binding ? personaById.get(binding.personaId) as any : null;
                return (
                  <div key={contact.id} className="p-3 bg-muted/20 rounded-lg flex flex-col sm:flex-row gap-3 sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="w-4 h-4 text-primary/60 flex-shrink-0" />
                        <span className="font-medium text-sm text-foreground truncate">{contact.name}</span>
                        {binding && (
                          <span className="text-xs text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                            已绑定 {boundPersona?.name ?? `#${binding.personaId}`}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{new Date(contact.lastMessageAt).toLocaleString("zh-CN", { hour12: false })}</span>
                        <span className="truncate">{contact.lastMessagePreview}</span>
                      </div>
                    </div>

                    {binding ? (
                      <Button size="sm" variant="outline" className="rounded-xl border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 active:scale-[0.98] transition-all"
                        onClick={() => unbindContact.mutate({ id: binding.id })}
                        disabled={unbindContact.isPending}>
                        解除绑定
                      </Button>
                    ) : (
                      <Button size="sm" className="bg-primary hover:bg-primary/95 text-primary-foreground rounded-xl shadow-xs hover:shadow-md active:scale-[0.98] transition-all"
                        onClick={() => handleBind(contact)}
                        disabled={bindContact.isPending || !selectedPersonaId}>
                        进行绑定
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── QQ TAB ──────────────────────────────────────────────────────────────────

function QqTab() {
  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const qqStatus = trpc.qq.getStatus.useQuery(undefined, { refetchInterval: 5000 });
  const recentContacts = trpc.qq.recentContacts.useQuery(undefined, { refetchInterval: 3000 });
  const bindings = trpc.qq.listBindings.useQuery(undefined, { refetchInterval: 3000 });
  const personas = trpc.persona.list.useQuery();
  const bot = qqStatus.data;
  const webhookUrl = typeof window === "undefined"
    ? "/api/qq/onebot/event"
    : `${window.location.origin}/api/qq/onebot/event`;

  const readyPersonas = useMemo(
    () => (personas.data ?? []).filter((p: any) => p.analysisStatus === "ready"),
    [personas.data],
  );
  const personaById = useMemo(
    () => new Map((personas.data ?? []).map((p: any) => [p.id, p])),
    [personas.data],
  );
  const bindingByContactId = useMemo(
    () => new Map((bindings.data ?? []).map((b: any) => [b.wechatContactId, b])),
    [bindings.data],
  );

  useEffect(() => {
    if (!selectedPersonaId && readyPersonas.length > 0) {
      setSelectedPersonaId(String(readyPersonas[0].id));
    }
  }, [readyPersonas, selectedPersonaId]);

  const bindContact = trpc.qq.bindContact.useMutation({
    onSuccess: () => { toast.success("QQ 联系人已绑定"); bindings.refetch(); personas.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const unbindContact = trpc.qq.unbindContact.useMutation({
    onSuccess: () => { toast.success("已解除绑定"); bindings.refetch(); personas.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const handleBind = (contact: { id: string; name: string }) => {
    const personaId = Number(selectedPersonaId);
    if (!personaId) {
      toast.error("请先选择分身");
      return;
    }
    bindContact.mutate({
      personaId,
      qqContactId: contact.id,
      qqName: contact.name,
    });
  };

  const statusText = bot?.status === "connected" ? "已连接"
    : bot?.status === "error" ? "连接异常"
    : "未启用";

  return (
    <div className="space-y-6">
      <section className="warm-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          {bot?.status === "connected"
            ? <Wifi className="w-5 h-5 text-emerald-500" />
            : <WifiOff className="w-5 h-5 text-muted-foreground" />}
          <h2 className="font-semibold text-foreground">QQ OneBot 接入</h2>
          <span className="text-sm text-muted-foreground ml-auto">{statusText}</span>
        </div>

        <div className="p-4 bg-muted/20 rounded-xl space-y-3">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${
              bot?.status === "connected" ? "bg-emerald-500" :
              bot?.status === "error" ? "bg-red-400" : "bg-muted-foreground/30"
            }`} />
            <span className="text-sm text-foreground font-medium">
              {bot?.status === "connected" ? `NapCat 已连接${bot.loggedInUser ? `：${bot.loggedInUser}` : ""}` :
               bot?.status === "error" ? "NapCat / OneBot HTTP API 不可用" : "QQ 端未启用"}
            </span>
          </div>

          <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
            <p>QQ 端由 NapCatQQ 独立运行，Mirrai 通过 OneBot HTTP API 发消息，并通过 HTTP POST 上报接收消息。</p>
            <p>NapCat HTTP API 地址：<span className="font-mono text-foreground">{bot?.baseUrl ?? "http://127.0.0.1:3001"}</span></p>
            <p>NapCat 事件上报地址：<span className="font-mono text-foreground break-all">{webhookUrl}</span></p>
            {bot?.webhookSecretConfigured && (
              <p className="text-amber-600">已启用 webhook token 校验，上报时需要带 `?token=你的 QQ_ONEBOT_WEBHOOK_SECRET` 或 `x-mirrai-token` 请求头。</p>
            )}
            {!bot?.enabled && (
              <p>要启用 QQ：在本机运行副本 `.env` 设置 `QQ_ENABLED=true`，再重启 Mirrai。</p>
            )}
            {bot?.lastError && (
              <p className="text-red-500">最近错误：{bot.lastError}</p>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="rounded-xl border-border"
            onClick={() => qqStatus.refetch()} disabled={qqStatus.isFetching}>
            {qqStatus.isFetching ? "刷新中..." : "刷新状态"}
          </Button>
        </div>
      </section>

      <section className="warm-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary/70" />
          <h2 className="font-semibold text-foreground">QQ 联系人绑定</h2>
          <span className="text-sm text-muted-foreground ml-auto">{bindings.data?.length ?? 0} 个已绑定</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3">
          <div className="space-y-2">
            <Label className="text-xs text-foreground/70">选择分身</Label>
            <select value={selectedPersonaId} onChange={e => setSelectedPersonaId(e.target.value)}
              className="w-full h-10 px-3 bg-muted/50 border border-border rounded-lg text-sm text-foreground">
              {readyPersonas.length === 0 && <option value="">暂无可绑定分身</option>}
              {readyPersonas.map((persona: any) => (
                <option key={persona.id} value={persona.id}>{persona.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-foreground/70">最近 QQ 联系人</Label>
            <div className="space-y-2">
              {(recentContacts.data ?? []).length === 0 && (
                <div className="p-3 bg-muted/20 rounded-lg text-sm text-muted-foreground">
                  暂无联系人。启用 NapCat 上报后，让要绑定的 QQ 先发一条私聊消息。
                </div>
              )}

              {(recentContacts.data ?? []).map((contact: any) => {
                const binding = bindingByContactId.get(contact.id) as any;
                const boundPersona = binding ? personaById.get(binding.personaId) as any : null;
                return (
                  <div key={contact.id} className="p-3 bg-muted/20 rounded-lg flex flex-col sm:flex-row gap-3 sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="w-4 h-4 text-primary/60 flex-shrink-0" />
                        <span className="font-medium text-sm text-foreground truncate">{contact.name}</span>
                        <span className="text-[11px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">
                          {contact.kind === "group" ? "群聊" : "私聊"}
                        </span>
                        {binding && (
                          <span className="text-xs text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                            已绑定 {boundPersona?.name ?? `#${binding.personaId}`}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{new Date(contact.lastMessageAt).toLocaleString("zh-CN", { hour12: false })}</span>
                        <span className="truncate">{contact.lastMessagePreview}</span>
                      </div>
                    </div>

                    {binding ? (
                      <Button size="sm" variant="outline" className="rounded-xl border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 active:scale-[0.98] transition-all"
                        onClick={() => unbindContact.mutate({ id: binding.id })}
                        disabled={unbindContact.isPending}>
                        解除绑定
                      </Button>
                    ) : (
                      <Button size="sm" className="bg-primary hover:bg-primary/95 text-primary-foreground rounded-xl shadow-xs hover:shadow-md active:scale-[0.98] transition-all"
                        onClick={() => handleBind(contact)}
                        disabled={bindContact.isPending || !selectedPersonaId}>
                        进行绑定
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── OPERATIONS DIAGNOSTICS TAB ─────────────────────────────────────────────

function OperationsDiagnosticsTab() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [usageFilters, setUsageFilters] = useState({
    from: "",
    to: "",
    userId: "",
    personaId: "",
    route: "",
    provider: "",
    purpose: "",
    success: "all",
    limit: "50",
  });
  const diagnostics = trpc.system.operationsDiagnostics.useQuery(undefined, { refetchInterval: 10000 });
  const usageDetailsInput = useMemo(() => ({
    from: optionalUsageText(usageFilters.from),
    to: optionalUsageText(usageFilters.to),
    userId: isAdmin ? parseOptionalIntegerInput(usageFilters.userId) : undefined,
    personaId: parseOptionalIntegerInput(usageFilters.personaId),
    route: optionalUsageText(usageFilters.route),
    provider: optionalUsageText(usageFilters.provider),
    purpose: optionalUsageText(usageFilters.purpose),
    success: usageFilters.success === "success" ? true : usageFilters.success === "failed" ? false : undefined,
    limit: parseUsageLimit(usageFilters.limit),
  }), [isAdmin, usageFilters]);
  const usageDetails = trpc.system.llmUsageDetails.useQuery(usageDetailsInput, { refetchInterval: 10000 });
  const data = diagnostics.data as any;

  if (diagnostics.isLoading) {
    return (
      <div className="warm-card p-6 text-sm text-muted-foreground">
        正在读取运行诊断...
      </div>
    );
  }

  if (diagnostics.error || !data) {
    return (
      <div className="warm-card p-5 space-y-4 border-destructive/20">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm font-medium">诊断读取失败</span>
        </div>
        <p className="text-xs text-muted-foreground break-words">{diagnostics.error?.message ?? "暂无诊断数据"}</p>
        <Button size="sm" variant="outline" className="rounded-xl border-border"
          onClick={() => diagnostics.refetch()}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />重新读取
        </Button>
      </div>
    );
  }

  const databaseModeLabel: Record<string, string> = {
    local: "本机 PostgreSQL",
    neon: "Neon PostgreSQL",
    remote: "远程 PostgreSQL",
    unconfigured: "未配置",
    invalid: "连接串异常",
  };
  const databaseTone: Record<string, StatusTone> = {
    local: "ok",
    neon: "ok",
    remote: "warn",
    unconfigured: "error",
    invalid: "error",
  };
  const qqLive = data.live?.qq;
  const wechatLive = data.live?.wechat;
  const qqStatusTone: StatusTone = qqLive?.status === "connected" ? "ok" : qqLive?.status === "error" ? "error" : "muted";
  const wechatStatusTone: StatusTone = wechatLive?.status === "logged_in" ? "ok" : wechatLive?.status === "error" ? "error" : wechatLive?.status === "starting" || wechatLive?.status === "scanning" ? "warn" : "muted";
  const troubleshootingItems = data.troubleshooting?.items ?? [];
  const qqAdvice = data.troubleshooting?.platforms?.qq ?? platformDiagnosticAdvice("qq", qqLive);
  const wechatAdvice = data.troubleshooting?.platforms?.wechat ?? platformDiagnosticAdvice("wechat", wechatLive);
  const configuredProviders = (data.llm?.providers ?? []).filter((provider: any) => provider.configured);
  const enabledStickerTypes = Object.entries(data.stickers?.enabledByType ?? {})
    .map(([type, count]) => `${type} ${count}`)
    .join("、") || "无";
  const providerOverrideText = Object.entries(data.proactiveMessages?.llmProviderOverrides ?? {})
    .map(([provider, count]) => `${provider} ${count}`)
    .join("、") || "无";
  const usageDetailsData = usageDetails.data as any;
  const usageRecords = usageDetailsData?.records ?? [];

  return (
    <div className="space-y-6">
      <section className="warm-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-foreground">运维诊断</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {formatDiagnosticTime(data.generatedAt)} · {data.runtime?.nodeEnv ?? "development"}
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="rounded-xl border-border"
            onClick={() => diagnostics.refetch()} disabled={diagnostics.isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${diagnostics.isFetching ? "animate-spin" : ""}`} />
            {diagnostics.isFetching ? "刷新中..." : "刷新"}
          </Button>
        </div>
      </section>

      <DiagnosticCard icon={AlertTriangle} title="运维排障清单"
        subtitle={`${data.troubleshooting?.summary?.errors ?? 0} 个错误 · ${data.troubleshooting?.summary?.warnings ?? 0} 个提醒`}>
        {troubleshootingItems.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {troubleshootingItems.map((item: DiagnosticAdvice, index: number) => (
              <AdvisoryBox key={item.id ?? `${item.scope}-${index}`} advice={item} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2.5 text-xs text-muted-foreground">
            当前没有需要处理的配置或运行错误；如外部平台仍异常，请刷新诊断或查看本机服务日志。
          </div>
        )}
      </DiagnosticCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DiagnosticCard icon={Server} title="运行与数据库"
          subtitle={<span className="font-mono break-all">{data.runtime?.cwd}</span>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
              <DiagnosticRow label="数据库模式" value=""
                badge={<StatusBadge label={databaseModeLabel[data.database?.mode] ?? data.database?.mode ?? "未知"} tone={databaseTone[data.database?.mode] ?? "muted"} />} />
              <DiagnosticRow label="Host" value={data.database?.host || "未配置"} mono />
              <DiagnosticRow label="Database" value={data.database?.database || "未配置"} mono />
              <DiagnosticRow label="推荐命令" value={data.database?.recommendedDevCommand || "corepack pnpm run dev"} mono />
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
              <DiagnosticRow label="运行副本" value={data.runtime?.localWorktree || "F:/Code/Mirrai"} mono />
              <DiagnosticRow label="运行数据" value={data.runtime?.localDataRoot || "F:/.mirrai-local/Mirrai"} mono />
              <DiagnosticRow label="上传目录" value={data.runtime?.uploadDir || "未配置"} mono />
              <DiagnosticRow label="贴图目录" value={data.runtime?.stickerBaseDir || "未配置"} mono />
            </div>
          </div>
        </DiagnosticCard>

        <DiagnosticCard icon={Cpu} title="LLM 路由"
          subtitle={`${configuredProviders.length}/${data.llm?.providers?.length ?? 0} 个提供商已配置`}>
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <DiagnosticRow label="默认提供商" value={data.llm?.defaultProvider || "未设置"} />
            <DiagnosticRow label="DeepSeek 动态路由" value=""
              badge={<BoolBadge value={Boolean(data.llm?.dynamicDeepSeekRouting)} trueLabel="启用" falseLabel="未启用" />} />
            <DiagnosticRow label="用量来源" value={llmUsageSourceLabel(data.llm?.usage?.source)} />
            <DiagnosticRow label="今日调用" value={`${data.llm?.usage?.today?.calls ?? 0} 次 · 失败 ${data.llm?.usage?.today?.failedCalls ?? 0}`} />
            <DiagnosticRow label="今日 tokens" value={data.llm?.usage?.today?.totalTokens ?? 0} />
            <DiagnosticRow label="本周 tokens" value={`${data.llm?.usage?.week?.totalTokens ?? 0} · ${data.llm?.usage?.week?.calls ?? 0} 次`} />
            <DiagnosticRow label="本月 tokens" value={`${data.llm?.usage?.month?.totalTokens ?? 0} · ${data.llm?.usage?.month?.calls ?? 0} 次`} />
            <DiagnosticRow label="今日用户归属" value={llmUsageBucketText(data.llm?.usage?.byUser, "userId")} />
            <DiagnosticRow label="今日角色归属" value={llmUsageBucketText(data.llm?.usage?.byPersona, "personaId")} />
            <DiagnosticRow label="今日入口归属" value={llmUsageBucketText(data.llm?.usage?.byRoute, "route")} />
            <DiagnosticRow label="软额度状态" value=""
              badge={<StatusBadge label={llmBudgetStatusLabel(data.llm?.budget?.status)} tone={llmBudgetTone(data.llm?.budget?.status)} />} />
            <DiagnosticRow label="每日软额度" value={tokenBudgetText(data.llm?.budget?.daily)} />
            <DiagnosticRow label="月度软额度" value={tokenBudgetText(data.llm?.budget?.monthly)} />
            <DiagnosticRow label="额度建议" value={data.llm?.budget?.recommendation ?? "未配置软额度"} />
            <DiagnosticRow label="省额度模式" value=""
              badge={<StatusBadge label={llmEconomyLevelLabel(data.llm?.economy?.level)} tone={llmEconomyTone(data.llm?.economy?.level)} />} />
            <DiagnosticRow label="自动降成本" value={llmEconomyActionText(data.llm?.economy)} />
            <DiagnosticRow label="上下文上限" value={llmEconomyLimitText(data.llm?.economy?.limitsSummary, "context")} />
            <DiagnosticRow label="记忆召回上限" value={llmEconomyLimitText(data.llm?.economy?.limitsSummary, "memory")} />
            <DiagnosticRow label="资料库召回上限" value={llmEconomyLimitText(data.llm?.economy?.limitsSummary, "source")} />
            <DiagnosticRow label="执行建议" value={data.llm?.economy?.recommendation ?? "省额度模式未启用。"} />
            <DiagnosticRow label="上限说明" value={data.llm?.economy?.limitsSummary?.safeguards?.[0] ?? "这些数字是每轮保护上限，不是质量目标。"} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(data.llm?.providers ?? []).map((provider: any) => (
              <div key={provider.name} className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{provider.name}</span>
                  <BoolBadge value={provider.configured} />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground font-mono break-all">
                  {provider.model || provider.endpoint?.origin || "未设置模型"}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">用量明细</h3>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {usageDetailsData
                    ? `${llmUsageSourceLabel(usageDetailsData.source)} · ${usageDetailsData.summary?.calls ?? 0} 次 · ${usageDetailsData.summary?.totalTokens ?? 0} tokens`
                    : "读取中..."}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-8 rounded-lg border-border text-xs"
                  onClick={() => usageDetails.refetch()} disabled={usageDetails.isFetching}>
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${usageDetails.isFetching ? "animate-spin" : ""}`} />
                  刷新
                </Button>
                <Button size="sm" variant="outline" className="h-8 rounded-lg border-border text-xs"
                  onClick={() => setUsageFilters({
                    from: "",
                    to: "",
                    userId: "",
                    personaId: "",
                    route: "",
                    provider: "",
                    purpose: "",
                    success: "all",
                    limit: "50",
                  })}>
                  清空
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">开始时间</Label>
                <Input type="datetime-local" value={usageFilters.from}
                  onChange={e => setUsageFilters(filters => ({ ...filters, from: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">结束时间</Label>
                <Input type="datetime-local" value={usageFilters.to}
                  onChange={e => setUsageFilters(filters => ({ ...filters, to: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
              {isAdmin && (
                <div className="space-y-1">
                  <Label className="text-[11px] text-muted-foreground">用户 ID</Label>
                  <Input value={usageFilters.userId} inputMode="numeric" placeholder="全部"
                    onChange={e => setUsageFilters(filters => ({ ...filters, userId: e.target.value }))}
                    className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">角色 ID</Label>
                <Input value={usageFilters.personaId} inputMode="numeric" placeholder="全部"
                  onChange={e => setUsageFilters(filters => ({ ...filters, personaId: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">入口</Label>
                <Input value={usageFilters.route} placeholder="social.qq"
                  onChange={e => setUsageFilters(filters => ({ ...filters, route: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Provider</Label>
                <Input value={usageFilters.provider} placeholder="DeepSeek"
                  onChange={e => setUsageFilters(filters => ({ ...filters, provider: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Purpose</Label>
                <Input value={usageFilters.purpose} placeholder="chat"
                  onChange={e => setUsageFilters(filters => ({ ...filters, purpose: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">结果</Label>
                <select value={usageFilters.success}
                  onChange={e => setUsageFilters(filters => ({ ...filters, success: e.target.value }))}
                  className="w-full h-9 px-2 bg-background/60 border border-border/60 rounded-lg text-xs text-foreground">
                  <option value="all">全部</option>
                  <option value="success">成功</option>
                  <option value="failed">失败</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">条数</Label>
                <Input value={usageFilters.limit} inputMode="numeric"
                  onChange={e => setUsageFilters(filters => ({ ...filters, limit: e.target.value }))}
                  className="h-9 bg-background/60 border-border/60 rounded-lg text-xs" />
              </div>
            </div>

            {usageDetailsData && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-md bg-background/45 px-2.5 py-2">
                  <div className="text-sm font-semibold text-foreground">{usageDetailsData.summary?.calls ?? 0}</div>
                  <div className="text-[11px] text-muted-foreground">调用</div>
                </div>
                <div className="rounded-md bg-background/45 px-2.5 py-2">
                  <div className="text-sm font-semibold text-foreground">{usageDetailsData.summary?.failedCalls ?? 0}</div>
                  <div className="text-[11px] text-muted-foreground">失败</div>
                </div>
                <div className="rounded-md bg-background/45 px-2.5 py-2">
                  <div className="text-sm font-semibold text-foreground">{usageDetailsData.summary?.totalTokens ?? 0}</div>
                  <div className="text-[11px] text-muted-foreground">tokens</div>
                </div>
                <div className="rounded-md bg-background/45 px-2.5 py-2">
                  <div className="text-sm font-semibold text-foreground">{usageDetailsData.summary?.averageDurationMs ?? 0}ms</div>
                  <div className="text-[11px] text-muted-foreground">平均耗时</div>
                </div>
              </div>
            )}

            {usageDetails.error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300 break-words">
                {usageDetails.error.message}
              </div>
            )}

            {!usageDetails.error && usageDetails.isLoading && (
              <div className="rounded-lg border border-border/50 bg-background/35 px-3 py-2.5 text-xs text-muted-foreground">
                正在读取用量明细...
              </div>
            )}

            {!usageDetails.error && !usageDetails.isLoading && usageRecords.length === 0 && (
              <div className="rounded-lg border border-border/50 bg-background/35 px-3 py-2.5 text-xs text-muted-foreground">
                当前筛选下暂无记录。
              </div>
            )}

            {usageRecords.length > 0 && (
              <div className="space-y-2">
                {usageRecords.map((record: any) => (
                  <div key={record.id} className="rounded-lg border border-border/50 bg-background/45 px-3 py-2.5 min-w-0">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-muted-foreground">{formatDiagnosticTime(record.startedAt)}</span>
                          <StatusBadge label={record.success ? "成功" : "失败"} tone={record.success ? "ok" : "error"} />
                        </div>
                        <div className="mt-1 text-sm font-medium text-foreground break-words">
                          {record.provider}{record.model ? ` · ${record.model}` : ""}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground break-words">
                          {usageRecordMeta(record)}
                        </div>
                        {record.error && (
                          <div className="mt-2 rounded-md bg-red-500/5 px-2 py-1.5 font-mono text-[11px] text-red-700 dark:text-red-300 break-all">
                            {usageErrorPreview(record.error)}
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:min-w-[210px]">
                        <div className="rounded-md bg-muted/20 px-2 py-1.5 text-right">
                          <div className="text-xs font-semibold text-foreground">{record.totalTokens ?? 0}</div>
                          <div className="text-[10px] text-muted-foreground">total</div>
                        </div>
                        <div className="rounded-md bg-muted/20 px-2 py-1.5 text-right">
                          <div className="text-xs font-semibold text-foreground">{record.inputTokens ?? 0}/{record.outputTokens ?? 0}</div>
                          <div className="text-[10px] text-muted-foreground">in/out</div>
                        </div>
                        <div className="rounded-md bg-muted/20 px-2 py-1.5 text-right">
                          <div className="text-xs font-semibold text-foreground">{record.durationMs ?? 0}ms</div>
                          <div className="text-[10px] text-muted-foreground">耗时</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DiagnosticCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DiagnosticCard icon={MessageCircle} title="平台接入"
          subtitle="QQ / 微信实时状态与绑定策略">
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <DiagnosticRow label="QQ 开关" value=""
              badge={<BoolBadge value={Boolean(data.qq?.enabled)} trueLabel="已启用" falseLabel="未启用" />} />
            <DiagnosticRow label="QQ 实时状态" value=""
              badge={<StatusBadge label={platformStatusLabel("qq", qqLive?.status)} tone={qqStatusTone} />} />
            <DiagnosticRow label="OneBot" value={data.qq?.onebotEndpoint?.origin || "未配置"} mono />
            <DiagnosticRow label="Webhook token" value=""
              badge={<BoolBadge value={Boolean(data.qq?.webhookSecretConfigured)} />} />
            <DiagnosticRow label="群聊" value=""
              badge={<BoolBadge value={Boolean(data.qq?.allowGroups)} trueLabel="允许" falseLabel="关闭" />} />
            {qqLive?.lastError && <DiagnosticRow label="QQ 原始错误" value={qqLive.lastError} />}
            <AdvisoryBox advice={qqAdvice} />
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <DiagnosticRow label="微信开关" value=""
              badge={<BoolBadge value={Boolean(data.wechat?.enabled)} trueLabel="已启用" falseLabel="未启用" />} />
            <DiagnosticRow label="微信实时状态" value=""
              badge={<StatusBadge label={platformStatusLabel("wechat", wechatLive?.status)} tone={wechatStatusTone} />} />
            <DiagnosticRow label="Puppet" value={data.wechat?.puppet || "未配置"} />
            <DiagnosticRow label="Bot 名称" value={data.wechat?.botName || "未配置"} />
            <DiagnosticRow label="Session" value={data.wechat?.sessionDir || "未配置"} mono />
            {wechatLive?.lastError?.message && <DiagnosticRow label="微信原始错误" value={wechatLive.lastError.message} />}
            <AdvisoryBox advice={wechatAdvice} />
          </div>
        </DiagnosticCard>

        <DiagnosticCard icon={Radio} title="Runtime 收敛"
          subtitle="Web / QQ / 微信的人物运行时能力">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {Object.entries(data.platformRuntime ?? {}).map(([platform, runtime]: [string, any]) => (
              <div key={platform} className="rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold uppercase text-foreground">{platform}</span>
                  <BoolBadge value={Boolean(runtime.enabled)} trueLabel="启用" falseLabel="关闭" />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(runtime)
                    .filter(([key]) => key !== "enabled")
                    .map(([key, value]) => (
                      <StatusBadge key={key} label={runtimeCapabilityLabel(key)} tone={value ? "ok" : "muted"} />
                    ))}
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <DiagnosticRow label="文本 runtime" value={data.architecture?.textRuntime} mono />
            <DiagnosticRow label="媒体 runtime" value={data.architecture?.mediaRuntime} mono />
            <DiagnosticRow label="请求规范" value={data.architecture?.runtimeRequest} mono />
          </div>
        </DiagnosticCard>

        <DiagnosticCard icon={Database} title="持久化与数据安全"
          subtitle="运行态、导出、删除和迁移覆盖">
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <DiagnosticRow label="角色运行态" value={data.persistence?.runtimeStorage?.personaRuntime ?? "persona_runtime_states"} mono />
            <DiagnosticRow label="LLM 用量" value={data.persistence?.runtimeStorage?.llmUsage ?? "llm_usage_records"} mono />
            <DiagnosticRow label="本机清理脚本" value={data.persistence?.localRuntimeCleanupScript ?? "scripts/cleanup-local-runtime.ps1"} mono />
            <DiagnosticRow label="同步脚本" value={data.persistence?.syncScript ?? "scripts/sync-local-worktree.ps1"} mono />
            <DiagnosticRow label="正式迁移" value={compactList(data.persistence?.requiredMigrations, "暂无")} mono />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
              <div className="text-xs font-semibold text-foreground">导出覆盖</div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground break-words">
                {compactList(data.persistence?.exportSections)}
              </p>
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
              <div className="text-xs font-semibold text-foreground">删除覆盖</div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground break-words">
                {compactList(data.persistence?.deleteSections)}
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {(data.persistence?.notes ?? []).map((note: string, index: number) => (
              <div key={index} className="rounded-lg border border-border/50 bg-background/35 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {note}
              </div>
            ))}
          </div>
        </DiagnosticCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <DiagnosticCard icon={Volume2} title="语音">
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <DiagnosticRow label="回复策略" value=""
              badge={<StatusBadge label={voiceModeLabel(data.voice?.policy?.mode)} tone={data.voice?.policy?.enabled ? "ok" : "muted"} />} />
            <DiagnosticRow label="概率 / 冷却" value={`${data.voice?.policy?.probability ?? 0} · ${data.voice?.policy?.cooldownSeconds ?? 0}s`} />
            <DiagnosticRow label="ASR" value={`${data.voice?.asr?.provider ?? "未知"} · ${data.voice?.asr?.model ?? "未知"}`} />
            <DiagnosticRow label="TTS" value={`${ttsProviderLabel(data.voice?.tts?.provider)} -> ${ttsProviderLabel(data.voice?.tts?.fallbackProvider)}`} />
            <DiagnosticRow label="VoxCPM" value={data.voice?.tts?.voxcpmEndpoint?.origin ?? "未配置"} mono />
            <DiagnosticRow label="MiniMax" value=""
              badge={<BoolBadge value={Boolean(data.voice?.tts?.minimaxConfigured)} />} />
          </div>
        </DiagnosticCard>

        <DiagnosticCard icon={ImageIcon} title="表情包">
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <DiagnosticRow label="策略" value=""
              badge={<BoolBadge value={Boolean(data.stickers?.policy?.enabled)} trueLabel="启用" falseLabel="关闭" />} />
            <DiagnosticRow label="总量 / 启用" value={`${data.stickers?.total ?? 0} / ${data.stickers?.enabled ?? 0}`} />
            <DiagnosticRow label="类型" value={enabledStickerTypes} />
            <DiagnosticRow label="概率 / 冷却" value={`${data.stickers?.policy?.probability ?? 0} · ${data.stickers?.policy?.cooldownSeconds ?? 0}s`} />
            <DiagnosticRow label="目录" value={data.stickers?.baseDir ?? "未配置"} mono />
          </div>
        </DiagnosticCard>

        <DiagnosticCard icon={Terminal} title="主动消息">
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <DiagnosticRow label="总角色 / Ready" value={`${data.proactiveMessages?.totalPersonas ?? 0} / ${data.proactiveMessages?.readyPersonas ?? 0}`} />
            <DiagnosticRow label="启用角色" value={data.proactiveMessages?.enabledPersonas ?? 0} />
            <DiagnosticRow label="定时槽位" value={data.proactiveMessages?.configuredSlotCount ?? 0} />
            <DiagnosticRow label="时间" value={compactList(data.proactiveMessages?.uniqueTimes)} />
            <DiagnosticRow label="风格提示" value={`${data.proactiveMessages?.stylePromptConfiguredPersonas ?? 0} 个角色`} />
            <DiagnosticRow label="角色模型覆盖" value={providerOverrideText} />
          </div>
        </DiagnosticCard>
      </div>
    </div>
  );
}

// ─── DATA MANAGEMENT TAB ─────────────────────────────────────────────────────

function DataManagementTab() {
  const [, navigate] = useLocation();
  const { logout } = useAuth();
  const { data: accountStats } = trpc.user.getAccountStats.useQuery();
  const exportData = trpc.user.exportData.useMutation({
    onSuccess: (data) => {
      if (!data) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mirrai-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("数据导出成功");
    },
    onError: (e: any) => toast.error("导出失败：" + e.message),
  });

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const deleteAccount = trpc.user.deleteAccount.useMutation({
    onSuccess: () => {
      toast.success("账户已删除");
      logout();
      navigate(getLoginUrl());
    },
    onError: (e: any) => toast.error(e.message),
  });

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6">
      {/* Storage Overview */}
      {accountStats && (
        <section className="warm-card p-5">
          <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-primary/60" /> 存储概览
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">已用空间</span>
              <span className="font-medium text-foreground">{formatBytes(accountStats.storageUsed)}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary/60 rounded-full transition-all"
                style={{ width: `${Math.min(100, (accountStats.storageUsed / (100 * 1048576)) * 100)}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="text-center p-2 bg-muted/20 rounded-lg">
                <div className="text-sm font-semibold text-foreground">{accountStats.totalPersonas}</div>
                <div className="text-[10px] text-muted-foreground">分身</div>
              </div>
              <div className="text-center p-2 bg-muted/20 rounded-lg">
                <div className="text-sm font-semibold text-foreground">{accountStats.totalMessages}</div>
                <div className="text-[10px] text-muted-foreground">消息</div>
              </div>
              <div className="text-center p-2 bg-muted/20 rounded-lg">
                <div className="text-sm font-semibold text-foreground">{accountStats.totalFiles}</div>
                <div className="text-[10px] text-muted-foreground">文件</div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-3">
              <div className="text-center p-2 bg-muted/20 rounded-lg">
                <div className="text-sm font-semibold text-foreground">{accountStats.totalMemories ?? 0}</div>
                <div className="text-[10px] text-muted-foreground">记忆</div>
              </div>
              <div className="text-center p-2 bg-muted/20 rounded-lg">
                <div className="text-sm font-semibold text-foreground">{accountStats.totalSources ?? 0}</div>
                <div className="text-[10px] text-muted-foreground">资料</div>
              </div>
              <div className="text-center p-2 bg-muted/20 rounded-lg">
                <div className="text-sm font-semibold text-foreground">{accountStats.totalRoleplayChannels ?? 0}</div>
                <div className="text-[10px] text-muted-foreground">频道</div>
              </div>
              <div className="text-center p-2 bg-muted/20 rounded-lg">
                <div className="text-sm font-semibold text-foreground">{accountStats.totalLlmUsageRecords ?? 0}</div>
                <div className="text-[10px] text-muted-foreground">用量</div>
              </div>
              <div className="text-center p-2 bg-muted/20 rounded-lg">
                <div className="text-sm font-semibold text-foreground">{accountStats.totalRuntimeStates ?? 0}</div>
                <div className="text-[10px] text-muted-foreground">运行态</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Export */}
      <section className="warm-card p-5">
        <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
          <Download className="w-4 h-4 text-primary/60" /> 数据导出
        </h3>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
          导出账户资料、分身、角色运行态、对话、记忆、资料库、日记、Roleplay 频道、平台绑定和 LLM 用量记录。JSON 不包含密码哈希、会话 Cookie、LLM API Key、本机上传文件实体、TTS 缓存或本机数据库文件。
        </p>
        <Button size="sm" variant="outline" className="rounded-xl border-border"
          onClick={() => exportData.mutate()}
          disabled={exportData.isPending}>
          <Download className="w-3.5 h-3.5 mr-1.5" />
          {exportData.isPending ? "导出中..." : "导出全部数据"}
        </Button>
      </section>

      {/* Danger Zone */}
      <section className="warm-card p-5 border-destructive/20">
        <h3 className="text-sm font-medium text-destructive mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> 危险操作
        </h3>
        <div className="p-4 bg-destructive/5 rounded-xl border border-destructive/10">
          <p className="text-sm text-foreground font-medium mb-1">删除账户</p>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            永久删除你的账户和所有相关数据库记录，包括分身、角色运行态、对话、记忆、资料库、Roleplay、平台绑定和 LLM 用量记录。此操作不可撤销。
          </p>
          <Button size="sm" variant="destructive" className="rounded-xl"
            onClick={() => setShowDeleteDialog(true)}>
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> 删除账户
          </Button>
        </div>
      </section>

      {/* Delete Account Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-card border-border rounded-2xl max-w-sm">
          <DialogHeader><DialogTitle className="text-destructive">确认删除账户</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-destructive/5 rounded-xl border border-destructive/10">
              <p className="text-xs text-destructive leading-relaxed">
                此操作将永久删除你的账户及所有数据，包括 {accountStats?.totalPersonas || 0} 个分身、
                {accountStats?.totalMessages || 0} 条消息、{accountStats?.totalRuntimeStates || 0} 条运行态和 {accountStats?.totalFiles || 0} 个文件元数据。
                此操作不可撤销。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">输入密码确认</Label>
              <Input value={deletePassword} onChange={e => setDeletePassword(e.target.value)}
                type="password" placeholder="输入你的登录密码"
                className="h-10 bg-muted/50 border-border rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">输入 "删除我的账户" 确认</Label>
              <Input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="删除我的账户"
                className="h-10 bg-muted/50 border-border rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteDialog(false)} className="rounded-xl">取消</Button>
            <Button variant="destructive" className="rounded-xl"
              disabled={!deletePassword || deleteConfirmText !== "删除我的账户" || deleteAccount.isPending}
              onClick={() => deleteAccount.mutate({ confirmPassword: deletePassword })}>
              {deleteAccount.isPending ? "删除中..." : "永久删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── MAIN SETTINGS PAGE ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const [activeTab, setActiveTab] = useState<TabKey>("profile");

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <button onClick={() => navigate("/")}
            className="app-nav-back -ml-1 gap-1">
            <ArrowLeft className="w-4 h-4" /><span className="text-sm">返回</span>
          </button>
          <div className="app-nav-divider" />
          <div className="app-nav-title-group">
            <div className="app-nav-mark">
              <Leaf className="w-3.5 h-3.5" />
            </div>
            <div>
              <h1 className="app-nav-title">用户中心</h1>
              <p className="app-nav-subtitle">资料、AI 与数据管理</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-6 max-w-5xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-8 items-start">
          {/* 左侧侧边栏 (大屏常驻，移动端横向滚动) */}
          <aside className="flex md:flex-col gap-1 p-1.5 bg-card/60 backdrop-blur-md border border-border/40 rounded-2xl md:sticky md:top-20 overflow-x-auto scrollbar-hide">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium transition-all flex-shrink-0 md:w-full relative ${
                    isActive
                      ? "bg-primary/8 text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}>
                  {isActive && (
                    <span className="absolute left-0 top-3 bottom-3 w-1 bg-primary rounded-full hidden md:block" />
                  )}
                  <Icon className={`w-4.5 h-4.5 ${isActive ? "text-primary" : "text-muted-foreground/80"}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </aside>

          {/* 右侧内容 */}
          <div className="space-y-6 min-w-0">
            {activeTab === "profile" && <ProfileTab />}
            {activeTab === "ai" && <AISettingsTab />}
            {activeTab === "wechat" && <WeChatTab />}
            {activeTab === "qq" && <QqTab />}
            {activeTab === "diagnostics" && <OperationsDiagnosticsTab />}
            {activeTab === "data" && <DataManagementTab />}
          </div>
        </div>
      </main>
    </div>
  );
}
