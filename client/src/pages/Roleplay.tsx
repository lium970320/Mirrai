import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Brain,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";

const MOOD_LABELS: Record<string, string> = {
  warm: "温柔",
  playful: "俏皮",
  nostalgic: "思念",
  melancholy: "低落",
  happy: "开心",
  distant: "疏离",
};

function initials(name: string) {
  return (name || "?").slice(0, 1).toUpperCase();
}

function moodText(value: unknown) {
  const mood = typeof value === "object" && value && "emotionalState" in value
    ? String((value as { emotionalState?: unknown }).emotionalState || "")
    : "";
  return mood ? MOOD_LABELS[mood] || mood : "";
}

export default function Roleplay() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading } = useAuth();
  const utils = trpc.useUtils();

  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [name, setName] = useState("客厅");
  const [description, setDescription] = useState("两个角色在同一个生活场景里自然聊天。");
  const [scenePrompt, setScenePrompt] = useState("晚上，屋里安静，适合闲聊、照顾和自然相处。");
  const [memberIds, setMemberIds] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [allowSilence, setAllowSilence] = useState(false);

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/login");
    }
  }, [isAuthenticated, loading, navigate]);

  const personasQuery = trpc.persona.list.useQuery(undefined, { enabled: isAuthenticated });
  const channelsQuery = trpc.roleplay.list.useQuery(undefined, { enabled: isAuthenticated });
  const channelQuery = trpc.roleplay.get.useQuery(
    { channelId: selectedChannelId || 0, limit: 120 },
    { enabled: isAuthenticated && Boolean(selectedChannelId) },
  );

  const personas = (personasQuery.data ?? []) as any[];
  const readyPersonas = useMemo(
    () => personas.filter(persona => persona.analysisStatus === "ready"),
    [personas],
  );
  const channels = (channelsQuery.data ?? []) as any[];
  const channel = channelQuery.data?.channel as any | undefined;
  const messages = (channelQuery.data?.messages ?? []) as any[];

  useEffect(() => {
    if (!selectedChannelId && channels.length > 0) {
      setSelectedChannelId(channels[0].id);
    }
  }, [channels, selectedChannelId]);

  useEffect(() => {
    if (memberIds.length === 0 && readyPersonas.length >= 2) {
      setMemberIds(readyPersonas.slice(0, 2).map(persona => persona.id));
    }
  }, [memberIds.length, readyPersonas]);

  const refresh = async () => {
    await Promise.all([
      utils.roleplay.list.invalidate(),
      utils.roleplay.get.invalidate(),
      utils.persona.list.invalidate(),
    ]);
  };

  const createMutation = trpc.roleplay.create.useMutation({
    onSuccess: async (result) => {
      toast.success("角色频道已创建");
      setSelectedChannelId(result.id);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = trpc.roleplay.delete.useMutation({
    onSuccess: async () => {
      toast.success("角色频道已删除");
      setSelectedChannelId(null);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const postMutation = trpc.roleplay.postUserMessage.useMutation({
    onSuccess: async () => {
      setNote("");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const tickMutation = trpc.roleplay.tick.useMutation({
    onSuccess: async (result) => {
      if (result.spoken) {
        toast.success(`${result.speakerName} 说了一句`);
      } else {
        toast.message(`${result.speakerName} 这轮没有发言`);
      }
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const toggleMember = (personaId: number) => {
    setMemberIds(current => current.includes(personaId)
      ? current.filter(id => id !== personaId)
      : [...current, personaId]);
  };

  const moveMember = (personaId: number, direction: -1 | 1) => {
    setMemberIds(current => {
      const index = current.indexOf(personaId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const createChannel = async () => {
    if (memberIds.length < 2) {
      toast.error("至少选择两个 ready 分身");
      return;
    }
    await createMutation.mutateAsync({
      name,
      description,
      scenePrompt,
      memberPersonaIds: memberIds,
    });
  };

  const postNote = async () => {
    if (!selectedChannelId || !note.trim()) return;
    await postMutation.mutateAsync({
      channelId: selectedChannelId,
      content: note.trim(),
    });
  };

  const tick = async (personaId?: number) => {
    if (!selectedChannelId) return;
    await tickMutation.mutateAsync({ channelId: selectedChannelId, personaId, allowSilence });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="container max-w-6xl h-14 flex items-center gap-3">
          <button onClick={() => navigate("/")} className="app-nav-icon" title="返回">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">角色频道</h1>
            <p className="text-xs text-muted-foreground">让两个或多个分身在同一场景里轮流观察、思考和发言</p>
          </div>
        </div>
      </header>

      <main className="container max-w-6xl py-5 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        <aside className="space-y-4">
          <section className="border rounded-lg bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 font-medium text-sm">
              <Plus className="w-4 h-4" />
              新建频道
            </div>
            <Input value={name} onChange={event => setName(event.target.value)} placeholder="频道名" />
            <Textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="频道说明" className="min-h-20" />
            <Textarea value={scenePrompt} onChange={event => setScenePrompt(event.target.value)} placeholder="当前生活场景" className="min-h-24" />
            <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <span className="text-sm text-foreground">允许沉默</span>
              <Switch checked={allowSilence} onCheckedChange={setAllowSilence} />
            </label>
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">频道成员</div>
              <div className="grid grid-cols-1 gap-2">
                {readyPersonas.map(persona => (
                  <div
                    key={persona.id}
                    className={`flex items-center gap-2 rounded-md border px-2 py-2 text-left text-sm transition-colors ${
                      memberIds.includes(persona.id) ? "border-primary bg-primary/8" : "hover:bg-muted/50"
                    }`}
                  >
                    <button type="button" onClick={() => toggleMember(persona.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span className="w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                        {memberIds.includes(persona.id) ? memberIds.indexOf(persona.id) + 1 : initials(persona.name)}
                      </span>
                      <span className="flex-1 min-w-0 truncate">{persona.name}</span>
                    </button>
                    <span className="text-xs text-muted-foreground">{MOOD_LABELS[persona.emotionalState] || persona.emotionalState}</span>
                    {memberIds.includes(persona.id) && (
                      <span className="flex gap-1">
                        <button type="button" title="上移" onClick={() => moveMember(persona.id, -1)}
                          disabled={memberIds.indexOf(persona.id) === 0}
                          className="app-nav-icon h-7 w-7 disabled:opacity-35">
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button type="button" title="下移" onClick={() => moveMember(persona.id, 1)}
                          disabled={memberIds.indexOf(persona.id) === memberIds.length - 1}
                          className="app-nav-icon h-7 w-7 disabled:opacity-35">
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <Button onClick={createChannel} disabled={createMutation.isPending || memberIds.length < 2} className="w-full">
              {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              创建角色频道
            </Button>
          </section>

          <section className="border rounded-lg bg-card p-4 space-y-3">
            <div className="flex items-center gap-2 font-medium text-sm">
              <MessageCircle className="w-4 h-4" />
              已有频道
            </div>
            {channels.length === 0 ? (
              <div className="text-sm text-muted-foreground py-3">还没有角色频道。</div>
            ) : (
              <div className="space-y-2">
                {channels.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedChannelId(item.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      selectedChannelId === item.id ? "border-primary bg-primary/8" : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="text-sm font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {item.members?.map((member: any) => member.personaName).join("、") || "无成员"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>

        <section className="border rounded-lg bg-card min-h-[640px] flex flex-col overflow-hidden">
          {channel ? (
            <>
              <div className="border-b px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold truncate">{channel.name}</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      {channel.members.length} 人
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{channel.scenePrompt || channel.description || "无场景说明"}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => tick()} disabled={tickMutation.isPending}>
                  {tickMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  推进一轮
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => selectedChannelId && deleteMutation.mutate({ channelId: selectedChannelId })}
                  disabled={deleteMutation.isPending}
                  title="删除频道"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              <div className="border-b px-4 py-3 flex flex-wrap gap-2">
                {channel.members.map((member: any) => (
                  <Button
                    key={member.personaId}
                    variant="outline"
                    size="sm"
                    onClick={() => tick(member.personaId)}
                    disabled={tickMutation.isPending || member.analysisStatus !== "ready"}
                  >
                    <Brain className="w-3.5 h-3.5 mr-1.5" />
                    让 {member.personaName} 说话
                  </Button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="h-full min-h-[360px] flex items-center justify-center text-sm text-muted-foreground">
                    频道还没有消息。
                  </div>
                ) : (
                  messages.map(message => {
                    const isUser = message.role === "user";
                    return (
                      <div key={message.id} className={`flex ${isUser ? "justify-center" : "justify-start"}`}>
                        <div className={`max-w-[82%] rounded-lg border px-3 py-2 ${isUser ? "bg-muted/40" : "bg-background"}`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                              {initials(message.speakerName)}
                            </span>
                            <span className="text-sm font-medium">{message.speakerName}</span>
                            {moodText(message.moodState) && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                {moodText(message.moodState)}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div>
                          {message.innerThought && (
                            <details className="mt-2 text-xs text-muted-foreground">
                              <summary className="cursor-pointer select-none">内心思考</summary>
                              <div className="mt-1 border-l-2 pl-2">{message.innerThought}</div>
                            </details>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="border-t p-3 flex gap-2">
                <Textarea
                  value={note}
                  onChange={event => setNote(event.target.value)}
                  placeholder="写一条场景提示或用户插话，例如：你们今晚都在客厅，外面下雨了。"
                  className="min-h-12 max-h-28"
                  onKeyDown={event => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      postNote();
                    }
                  }}
                />
                <Button onClick={postNote} disabled={postMutation.isPending || !note.trim()} className="self-end">
                  {postMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-muted-foreground">
              <div>
                <Users className="w-8 h-8 mx-auto mb-3 opacity-60" />
                <div className="text-sm">选择或创建一个角色频道。</div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
