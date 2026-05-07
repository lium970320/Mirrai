import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft, Save, Eye, X, Plus, Sparkles, Bell, Clock, Upload
} from "lucide-react";
import { toast } from "sonner";

const ATTACHMENT_STYLES = ["安全型", "焦虑型", "回避型", "混乱型"];
const LOVE_LANGUAGES = ["精心时刻", "肯定的言辞", "服务的行动", "身体接触", "接收礼物"];
const DEFAULT_PROACTIVE_TIME = "09:00";

function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (v && !tags.includes(v)) { onChange([...tags, v]); setInput(""); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 bg-primary/10 text-primary rounded-full">
            {t}
            <button onClick={() => onChange(tags.filter((_, j) => j !== i))}
              className="hover:text-destructive"><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="输入后回车添加" className="h-8 bg-muted/50 border-border rounded-lg text-sm flex-1" />
        <Button size="sm" variant="ghost" onClick={add} className="h-8 px-2 rounded-lg">
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function PersonaEdit() {
  const params = useParams<{ id: string }>();
  const personaId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const { data: persona, refetch } = trpc.persona.get.useQuery(
    { id: personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  const { data: promptData } = trpc.persona.getSystemPrompt.useQuery(
    { id: personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  const providers = trpc.llmConfig.listProviders.useQuery();

  const updateMutation = trpc.persona.update.useMutation({
    onSuccess: () => { toast.success("基本信息已保存"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateDataMutation = trpc.persona.updatePersonaData.useMutation({
    onSuccess: () => { toast.success("人设数据已保存"); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const [name, setName] = useState("");
  const [relationshipDesc, setRelationshipDesc] = useState("");
  const [togetherFrom, setTogetherFrom] = useState("");
  const [togetherTo, setTogetherTo] = useState("");
  const [llmProvider, setLlmProvider] = useState("");
  const [personality, setPersonality] = useState("");
  const [speakingStyle, setSpeakingStyle] = useState("");
  const [catchphrases, setCatchphrases] = useState<string[]>([]);
  const [nickname, setNickname] = useState("");
  const [memories, setMemories] = useState("");
  const [longBackground, setLongBackground] = useState("");
  const [attachmentStyle, setAttachmentStyle] = useState("");
  const [loveLanguage, setLoveLanguage] = useState("");
  const [conflictStyle, setConflictStyle] = useState("");
  const [touchingMoments, setTouchingMoments] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [starterQuestions, setStarterQuestions] = useState<string[]>([]);
  const [proactiveEnabled, setProactiveEnabled] = useState(false);
  const [proactiveTimes, setProactiveTimes] = useState<string[]>([]);
  const [proactiveTimeInput, setProactiveTimeInput] = useState(DEFAULT_PROACTIVE_TIME);
  const [proactiveStylePrompt, setProactiveStylePrompt] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!persona) return;
    setName(persona.name || "");
    setRelationshipDesc(persona.relationshipDesc || "");
    setTogetherFrom(persona.togetherFrom || "");
    setTogetherTo(persona.togetherTo || "");
    setLlmProvider((persona as any).llmProvider || "");
    const p = (persona.personaData as any) || {};
    setPersonality(p.personality || "");
    setSpeakingStyle(p.speakingStyle || "");
    setCatchphrases(p.catchphrases || []);
    setNickname(p.nickname || "");
    setMemories(p.memories || "");
    setLongBackground(p.longBackground || "");
    setAttachmentStyle(p.attachmentStyle || "");
    setLoveLanguage(p.loveLanguage || "");
    setConflictStyle(p.conflictStyle || "");
    setTouchingMoments(p.touchingMoments || "");
    setCustomInstructions(p.customInstructions || "");
    setStarterQuestions(p.starterQuestions || []);
    setProactiveEnabled(Boolean(p.proactiveMessages?.enabled));
    setProactiveTimes(Array.isArray(p.proactiveMessages?.times) ? p.proactiveMessages.times : []);
    setProactiveStylePrompt(p.proactiveMessages?.stylePrompt || "");
  }, [persona]);

  const saveBasic = () => updateMutation.mutate({
    id: personaId, name, relationshipDesc,
    togetherFrom: togetherFrom || undefined, togetherTo: togetherTo || undefined,
    llmProvider: llmProvider || undefined,
  });

  const addProactiveTime = () => {
    if (!/^\d{2}:\d{2}$/.test(proactiveTimeInput)) return;
    if (!proactiveTimes.includes(proactiveTimeInput)) {
      setProactiveTimes([...proactiveTimes, proactiveTimeInput].sort());
    }
  };

  const savePersonaData = () => {
    const current = ((persona?.personaData as any) || {});
    const currentProactive = current.proactiveMessages || {};

    updateDataMutation.mutate({
      id: personaId,
      personaData: {
        ...current,
        personality,
        speakingStyle,
        catchphrases,
        nickname,
        memories,
        longBackground,
        attachmentStyle,
        loveLanguage,
        conflictStyle,
        touchingMoments,
        customInstructions,
        starterQuestions,
        proactiveMessages: {
          ...currentProactive,
          enabled: proactiveEnabled,
          times: proactiveTimes,
          stylePrompt: proactiveStylePrompt,
        },
      },
    });
  };

  if (!persona) return null;

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
            <div>
              <p className="app-nav-title">{persona.name}</p>
              <p className="app-nav-subtitle">编辑分身</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-2xl mx-auto space-y-6">
        {/* Basic Info */}
        <section className="warm-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-foreground">基本信息</h2>
            <Button size="sm" variant="outline" className="rounded-xl border-border"
              onClick={() => navigate(`/upload/${personaId}`)}>
              <Upload className="w-3.5 h-3.5 mr-1.5" />资料文件
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/70">名字</Label>
              <Input value={name} onChange={e => setName(e.target.value)}
                className="h-9 bg-muted/50 border-border rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/70">关系描述</Label>
              <Input value={relationshipDesc} onChange={e => setRelationshipDesc(e.target.value)}
                className="h-9 bg-muted/50 border-border rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/70">在一起日期</Label>
              <Input type="date" value={togetherFrom} onChange={e => setTogetherFrom(e.target.value)}
                className="h-9 bg-muted/50 border-border rounded-lg" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/70">分开日期（可选）</Label>
              <Input type="date" value={togetherTo} onChange={e => setTogetherTo(e.target.value)}
                className="h-9 bg-muted/50 border-border rounded-lg" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-foreground/70">指定 LLM 提供商（留空使用全局默认）</Label>
            <select value={llmProvider} onChange={e => setLlmProvider(e.target.value)}
              className="w-full h-9 bg-muted/50 border border-border rounded-lg text-sm px-3 text-foreground">
              <option value="">使用全局默认</option>
              {providers.data?.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <Button size="sm" onClick={saveBasic} disabled={updateMutation.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl">
            <Save className="w-3.5 h-3.5 mr-1.5" />{updateMutation.isPending ? "保存中..." : "保存基本信息"}
          </Button>
        </section>

        {/* Persona Data Editor */}
        {persona.analysisStatus === "ready" && (
          <section className="warm-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />人设数据
              </h2>
              <Button size="sm" variant="ghost" onClick={() => setShowPrompt(!showPrompt)}
                className="text-xs text-muted-foreground rounded-lg">
                <Eye className="w-3.5 h-3.5 mr-1" />{showPrompt ? "隐藏" : "预览"} System Prompt
              </Button>
            </div>

            {showPrompt && promptData && (
              <pre className="text-xs text-muted-foreground bg-muted/30 p-4 rounded-xl overflow-auto max-h-64 whitespace-pre-wrap border border-border">
                {promptData.prompt}
              </pre>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/70">性格特质</Label>
              <Textarea value={personality} onChange={e => setPersonality(e.target.value)}
                rows={3} className="bg-muted/50 border-border rounded-lg text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/70">说话方式</Label>
              <Textarea value={speakingStyle} onChange={e => setSpeakingStyle(e.target.value)}
                rows={2} className="bg-muted/50 border-border rounded-lg text-sm" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-foreground/70">称呼</Label>
                <Input value={nickname} onChange={e => setNickname(e.target.value)}
                  placeholder="宝贝" className="h-9 bg-muted/50 border-border rounded-lg" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-foreground/70">依恋类型</Label>
                <select value={attachmentStyle} onChange={e => setAttachmentStyle(e.target.value)}
                  className="w-full h-9 bg-muted/50 border border-border rounded-lg text-sm px-3 text-foreground">
                  <option value="">未设置</option>
                  {ATTACHMENT_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/70">口头禅</Label>
              <TagInput tags={catchphrases} onChange={setCatchphrases} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-foreground/70">爱的语言</Label>
                <select value={loveLanguage} onChange={e => setLoveLanguage(e.target.value)}
                  className="w-full h-9 bg-muted/50 border border-border rounded-lg text-sm px-3 text-foreground">
                  <option value="">未设置</option>
                  {LOVE_LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-foreground/70">争吵风格</Label>
                <Input value={conflictStyle} onChange={e => setConflictStyle(e.target.value)}
                  className="h-9 bg-muted/50 border-border rounded-lg" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/70">重要记忆</Label>
              <Textarea value={memories} onChange={e => setMemories(e.target.value)}
                rows={3} className="bg-muted/50 border-border rounded-lg text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/70">长篇人物设定 / 小说资料</Label>
              <Textarea value={longBackground} onChange={e => setLongBackground(e.target.value)}
                rows={10}
                placeholder="把小说里和这个人物有关的背景、经历、关系、价值观、说话习惯、禁忌、关键情节贴在这里。系统会在聊天时优先使用这些设定。"
                className="bg-muted/50 border-border rounded-lg text-sm leading-relaxed" />
              <p className="text-xs text-muted-foreground">
                当前已输入 {longBackground.length.toLocaleString("zh-CN")} 字。过长时系统会优先使用前约 32,000 字进入提示词。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/70">触动瞬间</Label>
              <Textarea value={touchingMoments} onChange={e => setTouchingMoments(e.target.value)}
                rows={2} className="bg-muted/50 border-border rounded-lg text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/70">自定义开场白</Label>
              <TagInput tags={starterQuestions} onChange={setStarterQuestions} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-foreground/70">附加指令（追加到 System Prompt 末尾）</Label>
              <Textarea value={customInstructions} onChange={e => setCustomInstructions(e.target.value)}
                rows={3} placeholder="例如：回复时多用表情包描述、每次回复不超过50字..."
                className="bg-muted/50 border-border rounded-lg text-sm" />
            </div>

            <div className="border border-border rounded-xl p-4 space-y-4 bg-muted/20">
              <div className="flex items-center gap-3">
                <Bell className="w-4 h-4 text-primary" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium text-foreground">主动消息</h3>
                  <p className="text-xs text-muted-foreground">服务运行且微信已登录时，在设定时间主动给已绑定联系人发消息。</p>
                </div>
                <Switch checked={proactiveEnabled} onCheckedChange={setProactiveEnabled} />
              </div>

              <div className="flex flex-wrap gap-2">
                {proactiveTimes.map(time => (
                  <span key={time} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 bg-primary/10 text-primary rounded-full">
                    <Clock className="w-3 h-3" />{time}
                    <button onClick={() => setProactiveTimes(proactiveTimes.filter(t => t !== time))}
                      className="hover:text-destructive"><X className="w-3 h-3" /></button>
                  </span>
                ))}
                {proactiveTimes.length === 0 && (
                  <span className="text-xs text-muted-foreground">还没有设置时间点</span>
                )}
              </div>

              <div className="flex gap-2">
                <Input type="time" value={proactiveTimeInput} onChange={e => setProactiveTimeInput(e.target.value)}
                  className="h-9 bg-card border-border rounded-lg max-w-[140px]" />
                <Button size="sm" variant="outline" onClick={addProactiveTime}
                  className="rounded-lg">
                  <Plus className="w-3.5 h-3.5" />添加时间
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-foreground/70">主动消息风格补充</Label>
                <Textarea value={proactiveStylePrompt} onChange={e => setProactiveStylePrompt(e.target.value)}
                  rows={2}
                  placeholder="例如：早上偏关心，晚上偏分享回忆；不要太热情；偶尔提到小说里的某个细节。"
                  className="bg-card border-border rounded-lg text-sm" />
              </div>
            </div>

            <Button size="sm" onClick={savePersonaData} disabled={updateDataMutation.isPending}
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl">
              <Save className="w-3.5 h-3.5 mr-1.5" />{updateDataMutation.isPending ? "保存中..." : "保存人设数据"}
            </Button>
          </section>
        )}

        {persona.analysisStatus !== "ready" && (
          <div className="warm-card p-5 text-center text-muted-foreground text-sm">
            人设数据需要先完成 AI 解析才能编辑。
            <Button size="sm" variant="link" className="text-primary ml-1"
              onClick={() => navigate(`/upload/${personaId}`)}>去上传素材</Button>
          </div>
        )}
      </main>
    </div>
  );
}
