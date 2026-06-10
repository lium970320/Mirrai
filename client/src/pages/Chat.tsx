import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowLeft, Send, Sparkles, ChevronDown, Trash2, MoreVertical,
  Plus, Image, Mic, X, Play, Pause, Clock, BarChart3, Search, BookOpen, Theater,
  Volume2, Download, Activity, Archive, AlertTriangle, CheckCircle2, Filter, Pencil, RotateCcw, Save, Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import GraduationModal from "@/components/GraduationModal";
import PersonaStatePanel from "@/components/PersonaStatePanel";

interface Message {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  messageType?: "text" | "voice" | "image";
  mediaUrl?: string | null;
  mediaDuration?: number | null;
  emotionalState?: string;
  channel?: string;
  createdAt?: Date;
  isStreaming?: boolean;
}

const STATES: Record<string, { label: string; emoji: string; desc: string }> = {
  warm:       { label: "温柔",  emoji: "🌸", desc: "温柔体贴，充满关怀" },
  playful:    { label: "俏皮",  emoji: "😄", desc: "轻松活泼，爱开玩笑" },
  nostalgic:  { label: "思念",  emoji: "🌙", desc: "有些想念，带着回忆" },
  melancholy: { label: "忧郁",  emoji: "🌧️", desc: "情绪低落，需要安慰" },
  happy:      { label: "开心",  emoji: "✨", desc: "心情很好，充满活力" },
  distant:    { label: "疏离",  emoji: "❄️", desc: "有些距离感，话不多" },
};

function generateAvatar(name: string): string {
  const colors = [
    ["#7CB69D", "#5A9E7F"], ["#D4A574", "#C08B5C"],
    ["#8BAEC4", "#6B96B0"], ["#C4A0C4", "#A882A8"],
  ];
  const idx = (name?.charCodeAt(0) || 0) % colors.length;
  const [c1, c2] = colors[idx];
  const char = (name || "?").charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <defs><linearGradient id="a" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${c1}"/>
      <stop offset="100%" style="stop-color:${c2}"/>
    </linearGradient></defs>
    <rect width="40" height="40" rx="10" fill="url(#a)"/>
    <text x="20" y="26" font-family="sans-serif" font-size="16" font-weight="600" fill="white" text-anchor="middle">${char}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function VoicePlayer({ url, duration }: { url: string; duration?: number | null }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  };

  return (
    <button onClick={toggle} className="flex items-center gap-2 min-w-[120px]">
      {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      <div className="flex-1 flex items-center gap-0.5">
        {[...Array(12)].map((_, i) => (
          <div key={i} className={`w-1 rounded-full bg-current transition-all ${playing ? "animate-pulse" : ""}`}
            style={{ height: `${4 + Math.random() * 12}px`, animationDelay: `${i * 0.05}s` }} />
        ))}
      </div>
      {duration != null && <span className="text-xs opacity-60">{duration}″</span>}
    </button>
  );
}

function TTSButton({ text }: { text: string }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsMutation = trpc.chat.tts.useMutation();

  const handlePlay = async () => {
    if (audioUrl && audioRef.current) {
      if (playing) { audioRef.current.pause(); setPlaying(false); }
      else { audioRef.current.play(); setPlaying(true); }
      return;
    }
    setLoading(true);
    try {
      const result = await ttsMutation.mutateAsync({ text: text.slice(0, 500) });
      setAudioUrl(result.audioUrl);
      const audio = new Audio(result.audioUrl);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      audio.play();
      setPlaying(true);
    } catch { toast.error("语音生成失败"); }
    finally { setLoading(false); }
  };

  return (
    <button onClick={handlePlay} disabled={loading} title="朗读"
      className="text-muted-foreground/80 hover:text-muted-foreground transition-colors disabled:opacity-30 p-0.5">
      {loading ? <Sparkles className="w-3 h-3 animate-pulse" /> : <Volume2 className={`w-3 h-3 ${playing ? "text-primary" : ""}`} />}
    </button>
  );
}

function MessageBubble({ msg, personaName }: { msg: Message; personaName: string }) {
  const isUser = msg.role === "user";
  const state = msg.emotionalState ? STATES[msg.emotionalState] : null;
  const [imgExpanded, setImgExpanded] = useState(false);

  const renderContent = () => {
    if (msg.messageType === "image" && msg.mediaUrl) {
      return (
        <>
          <img src={msg.mediaUrl} alt="" onClick={() => setImgExpanded(true)}
            className="max-w-[200px] max-h-[200px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity" />
          {msg.content !== "[图片]" && <p className="mt-1.5 text-sm">{msg.content}</p>}
          {imgExpanded && (
            <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setImgExpanded(false)}>
              <img src={msg.mediaUrl!} alt="" className="max-w-full max-h-full object-contain rounded-lg" />
            </div>
          )}
        </>
      );
    }
    if (msg.messageType === "voice" && msg.mediaUrl) {
      return (
        <div className="flex flex-col gap-1">
          <VoicePlayer url={msg.mediaUrl} duration={msg.mediaDuration} />
          {msg.content && msg.content !== "（语音消息）" && (
            <p className="text-xs opacity-60 mt-1">{msg.content}</p>
          )}
        </div>
      );
    }
    if (msg.isStreaming) {
      return <span>{msg.content}<span className="inline-block w-1 h-4 bg-primary/40 ml-0.5 animate-pulse" /></span>;
    }
    if (isUser) return <span>{msg.content}</span>;
    return <Streamdown>{msg.content}</Streamdown>;
  };

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"} mb-4`}>
      {!isUser && (
        <img src={generateAvatar(personaName)} alt="" className="w-9 h-9 rounded-xl flex-shrink-0 mt-0.5" />
      )}
      <div className={`max-w-[75%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && state && (
          <span className={`text-xs px-2 py-0.5 rounded-full border state-bg-${msg.emotionalState} state-${msg.emotionalState}`}>
            {state.emoji} {state.label}
          </span>
        )}
        <div className={`px-3.5 py-2.5 text-sm leading-relaxed ${isUser ? "bubble-user" : "bubble-ai"}`}>
          {renderContent()}
        </div>
        {msg.createdAt && !msg.isStreaming && (
          <span className="text-xs text-muted-foreground/80 px-1 flex items-center gap-1.5">
            {new Date(msg.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            {msg.channel === "wechat" && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 rounded">微信</span>}
            {msg.channel === "qq" && <span className="text-[10px] px-1.5 py-0.5 bg-sky-500/10 text-sky-600 rounded">QQ</span>}
            {!isUser && msg.messageType !== "voice" && <TTSButton text={msg.content} />}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── MAIN CHAT ────────────────────────────────────────────────────────────────

export default function Chat() {
  const params = useParams<{ id: string }>();
  const personaId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [currentState, setCurrentState] = useState("warm");
  const [showStatePanel, setShowStatePanel] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onOnline = () => { setIsOnline(true); toast.success("网络已恢复"); };
    const onOffline = () => { setIsOnline(false); toast.error("网络连接已断开"); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const { data: persona } = trpc.persona.get.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && personaId > 0 }
  );

  const { data: intimacy } = trpc.persona.getIntimacy.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && personaId > 0 }
  );

  const { data: history } = trpc.chat.getHistory.useQuery(
    { personaId },
    { enabled: isAuthenticated && personaId > 0 }
  );

  const sendMutation = trpc.chat.send.useMutation({
    onError: (e: any) => {
      toast.error("发送失败：" + e.message);
      setIsSending(false);
    },
  });

  const clearMutation = trpc.chat.clear.useMutation({
    onSuccess: () => { setMessages([]); toast.success("对话已清空"); setShowMenu(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const [showMenu, setShowMenu] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showSourceLibrary, setShowSourceLibrary] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showEmotionReport, setShowEmotionReport] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showScenePanel, setShowScenePanel] = useState(false);
  const [showGraduation, setShowGraduation] = useState(false);

  const { data: scenesList } = trpc.scene.list.useQuery(undefined, { enabled: isAuthenticated });
  const activateSceneMutation = trpc.scene.activate.useMutation({
    onSuccess: () => { toast.success("场景已激活"); setShowScenePanel(false); },
  });
  const deactivateSceneMutation = trpc.scene.deactivate.useMutation({
    onSuccess: () => { toast.success("已退出场景"); setShowScenePanel(false); },
  });

  const activeScene = scenesList?.find((s: any) => s.id === persona?.activeSceneId);

  const changeStateMutation = trpc.persona.update.useMutation({
    onSuccess: () => toast.success("情感状态已切换"),
  });

  const sendImageMutation = trpc.chat.sendImage.useMutation({
    onError: (e: any) => { toast.error("图片发送失败：" + e.message); setIsSending(false); },
  });

  const sendVoiceMutation = trpc.chat.sendVoice.useMutation({
    onError: (e: any) => { toast.error("语音发送失败：" + e.message); setIsSending(false); },
  });

  const exportMutation = trpc.chat.export.useMutation();

  const handleExport = async () => {
    try {
      const result = await exportMutation.mutateAsync({ personaId });
      const blob = new Blob([result.html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    } catch (e: any) { toast.error("导出失败：" + e.message); }
  };

  useEffect(() => {
    if (history) {
      setMessages(history.map((m: any) => ({
        id: m.id, role: m.role as "user" | "assistant",
        content: m.content, messageType: m.messageType, mediaUrl: m.mediaUrl, mediaDuration: m.mediaDuration,
        emotionalState: m.emotionalState, channel: m.channel, createdAt: m.createdAt,
      })));
    }
  }, [history]);

  useEffect(() => {
    if (persona?.emotionalState) setCurrentState(persona.emotionalState);
  }, [persona?.emotionalState]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isSending) return;
    setInput("");
    setIsSending(true);

    const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: text, createdAt: new Date() };
    setMessages(prev => [...prev, userMsg]);

    const streamId = `stream-${Date.now()}`;
    setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState }]);

    try {
      const result = await sendMutation.mutateAsync({ personaId, message: text });
      setMessages(prev => prev.map(m => m.id === streamId
        ? { id: `ai-${Date.now()}`, role: "assistant", content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), isStreaming: false }
        : m
      ));
      setCurrentState(result.emotionalState);
      if (result.graduationSuggested) setShowGraduation(true);
    } catch {
      setMessages(prev => prev.filter(m => m.id !== streamId));
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isSending) return;
    setShowAttach(false);
    setIsSending(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1];
      const localUrl = URL.createObjectURL(file);
      const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: "[图片]", messageType: "image", mediaUrl: localUrl, createdAt: new Date() };
      setMessages(prev => [...prev, userMsg]);
      const streamId = `stream-${Date.now()}`;
      setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState }]);

      try {
        const result = await sendImageMutation.mutateAsync({ personaId, imageContent: base64, fileName: file.name, mimeType: file.type });
        setMessages(prev => prev.map(m => m.id === streamId
          ? { id: `ai-${Date.now()}`, role: "assistant", content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), isStreaming: false }
          : m
        ));
        setCurrentState(result.emotionalState);
      } catch { setMessages(prev => prev.filter(m => m.id !== streamId)); }
      finally { setIsSending(false); }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [isSending, personaId, currentState]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const duration = recordingTime;
          setIsRecording(false);
          setRecordingTime(0);
          setIsSending(true);

          const localUrl = URL.createObjectURL(blob);
          const userMsg: Message = { id: `temp-${Date.now()}`, role: "user", content: "（语音消息）", messageType: "voice", mediaUrl: localUrl, mediaDuration: duration, createdAt: new Date() };
          setMessages(prev => [...prev, userMsg]);
          const streamId = `stream-${Date.now()}`;
          setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", isStreaming: true, emotionalState: currentState }]);

          try {
            const result = await sendVoiceMutation.mutateAsync({ personaId, audioContent: base64, duration, fileName: `voice-${Date.now()}.webm` });
            setMessages(prev => prev.map(m => {
              if (m.id === streamId) return { id: `ai-${Date.now()}`, role: "assistant", content: result.reply, emotionalState: result.emotionalState, createdAt: new Date(), isStreaming: false };
              if (m === userMsg) return { ...m, content: result.transcription || "（语音消息）" };
              return m;
            }));
            setCurrentState(result.emotionalState);
          } catch { setMessages(prev => prev.filter(m => m.id !== streamId)); }
          finally { setIsSending(false); }
        };
        reader.readAsDataURL(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch { toast.error("无法访问麦克风"); }
  }, [personaId, currentState, recordingTime]);

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    mediaRecorderRef.current?.stop();
  }, []);

  const cancelRecording = useCallback(() => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    setIsRecording(false);
    setRecordingTime(0);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const stateInfo = STATES[currentState] || STATES.warm;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 app-header flex-shrink-0">
        <div className="container app-nav">
          <button onClick={() => navigate("/")}
            className="app-nav-back -ml-1">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <img src={generateAvatar(persona?.name || "?")} alt="" className="w-9 h-9 rounded-xl" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-foreground font-medium text-sm leading-tight truncate">{persona?.name || "..."}</p>
                {intimacy && <span className="text-xs opacity-70" title={`${intimacy.level} · ${intimacy.score}分`}>{intimacy.icon}</span>}
                {activeScene && <span className="hidden sm:inline-flex max-w-[140px] truncate text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{activeScene.icon} {activeScene.name}</span>}
              </div>
              <p className="text-muted-foreground text-xs leading-tight truncate">{persona?.relationshipDesc || "TA"}</p>
            </div>
          </div>
          <button onClick={() => setShowStatePanel(!showStatePanel)}
            className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-full border text-xs font-medium transition-all state-bg-${currentState} state-${currentState}`}>
            <span>{stateInfo.emoji}</span><span className="hidden sm:inline">{stateInfo.label}</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${showStatePanel ? "rotate-180" : ""}`} />
          </button>
          <button onClick={() => setShowSearch(!showSearch)} title="搜索消息"
            className="app-nav-icon hidden sm:inline-flex">
            <Search className="w-4 h-4" />
          </button>
          <button onClick={() => setShowDiagnostics(true)} title="运行诊断" aria-label="打开运行诊断"
            className="app-nav-icon hidden md:inline-flex">
            <Activity className="w-4 h-4" />
          </button>
          <button onClick={() => setShowTimeline(true)} title="记忆时间线"
            className="app-nav-icon hidden md:inline-flex">
            <Clock className="w-4 h-4" />
          </button>
          <button onClick={() => setShowSourceLibrary(true)} title="资料库"
            className="app-nav-icon hidden md:inline-flex">
            <Database className="w-4 h-4" />
          </button>
          <button onClick={() => setShowEmotionReport(true)} title="情绪报告"
            className="app-nav-icon hidden md:inline-flex">
            <BarChart3 className="w-4 h-4" />
          </button>
          <button onClick={() => navigate(`/diary`)} title="对话日记"
            className="app-nav-icon hidden md:inline-flex">
            <BookOpen className="w-4 h-4" />
          </button>
          <button onClick={handleExport} title="导出对话" disabled={exportMutation.isPending}
            className="app-nav-icon hidden lg:inline-flex disabled:opacity-50">
            <Download className="w-4 h-4" />
          </button>
          <button onClick={() => setShowScenePanel(!showScenePanel)} title="场景模式"
            className={`app-nav-icon hidden sm:inline-flex ${activeScene ? "app-nav-icon-active" : ""}`}>
            <Theater className="w-4 h-4" />
          </button>
          <div className="relative">
            <button onClick={() => setShowMenu(!showMenu)}
              className="app-nav-icon">
              <MoreVertical className="w-4 h-4" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-lg py-1 min-w-[160px] z-50 animate-fade-in">
                <button onClick={() => { setShowSearch(true); setShowMenu(false); }}
                  className="sm:hidden w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                  <Search className="w-3.5 h-3.5" />搜索消息
                </button>
                <button onClick={() => { setShowDiagnostics(true); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                  <Activity className="w-3.5 h-3.5" />运行诊断
                </button>
                <button onClick={() => { setShowTimeline(true); setShowMenu(false); }}
                  className="md:hidden w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                  <Clock className="w-3.5 h-3.5" />记忆时间线
                </button>
                <button onClick={() => { setShowSourceLibrary(true); setShowMenu(false); }}
                  className="md:hidden w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                  <Database className="w-3.5 h-3.5" />资料库
                </button>
                <button onClick={() => { setShowEmotionReport(true); setShowMenu(false); }}
                  className="md:hidden w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                  <BarChart3 className="w-3.5 h-3.5" />情绪报告
                </button>
                <button onClick={() => { navigate(`/diary`); setShowMenu(false); }}
                  className="md:hidden w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                  <BookOpen className="w-3.5 h-3.5" />对话日记
                </button>
                <button onClick={() => { handleExport(); setShowMenu(false); }} disabled={exportMutation.isPending}
                  className="lg:hidden w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50">
                  <Download className="w-3.5 h-3.5" />导出对话
                </button>
                <button onClick={() => { setShowScenePanel(!showScenePanel); setShowMenu(false); }}
                  className="sm:hidden w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                  <Theater className="w-3.5 h-3.5" />场景模式
                </button>
                <button onClick={() => clearMutation.mutate({ personaId })}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />清空对话
                </button>
              </div>
            )}
          </div>
        </div>
        {showStatePanel && (
          <div className="border-t border-border bg-card px-4 py-3 animate-fade-in">
            <p className="text-muted-foreground text-xs mb-2">切换情感状态</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(STATES).map(([key, s]) => (
                <button key={key} onClick={() => {
                  changeStateMutation.mutate({ id: personaId, emotionalState: key as any });
                  setCurrentState(key); setShowStatePanel(false);
                }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all state-bg-${key} state-${key} ${currentState === key ? "opacity-100 ring-1 ring-primary/30" : "opacity-60 hover:opacity-90"}`}>
                  {s.emoji} {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {showSearch && <SearchPanel personaId={personaId} onClose={() => { setShowSearch(false); setSearchQuery(""); }} />}

      {showScenePanel && (
        <div className="border-b border-border bg-card/95 backdrop-blur-sm px-4 py-4 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold">场景模式</p>
            <button onClick={() => setShowScenePanel(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          {activeScene && (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">当前场景：{activeScene.icon} {activeScene.name}</span>
              <button onClick={() => deactivateSceneMutation.mutate({ personaId })}
                className="text-xs text-destructive hover:underline">退出场景</button>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(scenesList || []).map((scene: any) => (
              <button key={scene.id} onClick={() => activateSceneMutation.mutate({ personaId, sceneId: scene.id })}
                className={`text-left p-3 rounded-xl border transition-all ${scene.id === persona?.activeSceneId ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-base">{scene.icon || "🎭"}</span>
                  <span className="text-sm font-medium">{scene.name}</span>
                </div>
                {scene.description && <p className="text-xs text-muted-foreground line-clamp-2">{scene.description}</p>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="container py-6 max-w-2xl mx-auto">
          {messages.length === 0 && (
            <div className="text-center py-16 animate-fade-in">
              <div className="text-5xl mb-4 animate-float">{stateInfo.emoji}</div>
              <p className="text-foreground font-medium mb-1">{persona?.name} 在等你</p>
              <p className="text-muted-foreground text-sm">{stateInfo.desc}</p>
              <div className="mt-6 flex flex-wrap gap-2 justify-center">
                {(((persona?.personaData as any)?.starterQuestions?.length > 0
                  ? (persona?.personaData as any).starterQuestions
                  : ["最近怎么样？", "你还记得我们第一次见面吗？", "我有点想你了", "你现在在做什么？"]) as string[]).map((q: string) => (
                  <button key={q} onClick={() => setInput(q)}
                    className="text-xs px-3 py-1.5 bg-muted border border-border rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map(msg => (
            <MessageBubble key={msg.id} msg={msg} personaName={persona?.name || "?"} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex-shrink-0 w-full bg-transparent px-4 pb-4 pt-1">
        <div className="chat-composer container py-3 px-4 max-w-2xl mx-auto">
          {isRecording ? (
            <div className="flex items-center gap-3 h-11">
              <button onClick={cancelRecording} className="text-destructive hover:bg-destructive/10 rounded-xl w-10 h-10 flex items-center justify-center">
                <X className="w-5 h-5" />
              </button>
              <div className="flex-1 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm text-foreground">录音中 {recordingTime}″</span>
                <div className="flex-1 flex items-center gap-0.5 px-2">
                  {[...Array(20)].map((_, i) => (
                    <div key={i} className="w-1 rounded-full bg-primary/40 animate-pulse"
                      style={{ height: `${4 + Math.random() * 16}px`, animationDelay: `${i * 0.08}s` }} />
                  ))}
                </div>
              </div>
              <Button onClick={stopRecording} className="h-11 w-11 p-0 bg-primary hover:bg-primary/90 text-primary-foreground border-0 rounded-xl flex-shrink-0">
                <Send className="w-5 h-5" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2.5 items-end">
              <div className="relative">
                <button onClick={() => setShowAttach(!showAttach)}
                  className="h-11 w-11 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors">
                  <Plus className={`w-5 h-5 transition-transform ${showAttach ? "rotate-45" : ""}`} />
                </button>
                {showAttach && (
                  <div className="absolute bottom-full left-0 mb-2 bg-card border border-border rounded-xl shadow-lg py-1 min-w-[140px] z-50 animate-fade-in">
                    <label className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors cursor-pointer">
                      <Image className="w-4 h-4" />发送图片
                      <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                    </label>
                    <button onClick={() => { setShowAttach(false); startRecording(); }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors">
                      <Mic className="w-4 h-4" />语音消息
                    </button>
                  </div>
                )}
              </div>
              <Textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown} placeholder={`对 ${persona?.name || "TA"} 说点什么...`}
                rows={1} className="flex-1 resize-none bg-muted/50 border-border text-foreground placeholder:text-muted-foreground/75 focus:border-primary/50 rounded-xl min-h-[44px] max-h-32" />
              <Button onClick={handleSend} disabled={!input.trim() || isSending || !isOnline}
                className="h-11 w-11 p-0 bg-primary hover:bg-primary/90 text-primary-foreground border-0 rounded-xl flex-shrink-0">
                {isSending ? <Sparkles className="w-5 h-5 animate-pulse" /> : <Send className="w-5 h-5" />}
              </Button>
            </div>
          )}
          <p className="hidden sm:block text-muted-foreground/75 text-xs mt-2 text-center">
            Enter 发送 · Shift+Enter 换行
          </p>
        </div>
      </div>

      {showTimeline && <MemoryTimeline personaId={personaId} onClose={() => setShowTimeline(false)} />}
      {showSourceLibrary && <SourceLibraryPanel personaId={personaId} onClose={() => setShowSourceLibrary(false)} />}
      {showDiagnostics && <PersonaStatePanel personaId={personaId} onClose={() => setShowDiagnostics(false)} />}
      {showEmotionReport && <EmotionReport personaId={personaId} personaName={persona?.name || "?"} onClose={() => setShowEmotionReport(false)} />}
      <GraduationModal personaId={personaId} personaName={persona?.name || "?"} open={showGraduation} onClose={() => setShowGraduation(false)} />
    </div>
  );
}

// ─── SEARCH PANEL ────────────────────────────────────────────────────────────

function SearchPanel({ personaId, onClose }: { personaId: number; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: results } = trpc.chat.search.useQuery(
    { personaId, query: debouncedQuery },
    { enabled: debouncedQuery.length > 0 }
  );

  const handleChange = (val: string) => {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQuery(val.trim()), 300);
  };

  const highlight = (text: string, q: string) => {
    if (!q) return text;
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="bg-primary/30 text-foreground rounded px-0.5">{part}</mark>
        : part
    );
  };

  return (
    <div className="border-b border-border bg-card animate-fade-in">
      <div className="container max-w-2xl mx-auto py-3">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input value={query} onChange={e => handleChange(e.target.value)} autoFocus
            placeholder="搜索消息..." className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none" />
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        {debouncedQuery && results && (
          <div className="mt-3 max-h-64 overflow-y-auto space-y-1.5">
            {results.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">没有找到相关消息</p>
            ) : (
              results.map((m: any) => (
                <div key={m.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer" onClick={onClose}>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${m.role === "user" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {m.role === "user" ? "我" : "TA"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground line-clamp-2">{highlight(m.content, debouncedQuery)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {new Date(m.createdAt).toLocaleDateString("zh-CN")} {new Date(m.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MEMORY GOVERNANCE ───────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  milestone: { label: "里程碑", color: "bg-amber-500" },
  memory: { label: "记忆", color: "bg-primary" },
  anniversary: { label: "纪念日", color: "bg-rose-500" },
};

const MEMORY_TYPE_LABELS: Record<string, string> = {
  user_fact: "用户事实",
  relationship_event: "关系事件",
  promise: "承诺约定",
  preference: "偏好习惯",
  emotional_moment: "情绪节点",
  conflict: "冲突修复",
  open_loop: "未完成话题",
  persona_background: "人物背景",
  source_fact: "原著资料",
  daily_summary: "每日总结",
};

const MEMORY_SOURCE_LABELS: Record<string, string> = {
  manual: "手动",
  chat: "聊天",
  daily_summary: "每日整理",
  source_material: "资料",
  import: "导入",
  system: "系统",
};

const MEMORY_STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  active: { label: "有效", tone: "bg-emerald-500/10 text-emerald-600" },
  archived: { label: "归档", tone: "bg-muted text-muted-foreground" },
  contradicted: { label: "标错", tone: "bg-destructive/10 text-destructive" },
};

const MEMORY_TYPES = Object.entries(MEMORY_TYPE_LABELS);
const MEMORY_SOURCES = Object.entries(MEMORY_SOURCE_LABELS);
const MEMORY_STATUSES = Object.entries(MEMORY_STATUS_LABELS);

type MemoryFormState = {
  title: string;
  description: string;
  category: "memory" | "milestone" | "anniversary";
  date: string;
  source: string;
  memoryType: string;
  importance: number;
  confidence: number;
  keywords: string;
  emotion: string;
  status: "active" | "archived" | "contradicted";
};

function keywordText(value: unknown): string {
  return Array.isArray(value)
    ? value
      .filter(item => typeof item === "string" || typeof item === "number")
      .map(String)
      .join("、")
    : "";
}

function emptyMemoryForm(): MemoryFormState {
  return {
    title: "",
    description: "",
    category: "memory",
    date: "",
    source: "manual",
    memoryType: "relationship_event",
    importance: 3,
    confidence: 3,
    keywords: "",
    emotion: "",
    status: "active",
  };
}

function memoryToForm(memory: any): MemoryFormState {
  return {
    title: memory.title || "",
    description: memory.description || "",
    category: memory.category || "memory",
    date: memory.date || "",
    source: memory.source || "manual",
    memoryType: memory.memoryType || "relationship_event",
    importance: memory.importance ?? 3,
    confidence: memory.confidence ?? 3,
    keywords: keywordText(memory.keywords),
    emotion: memory.emotion || "",
    status: memory.status || "active",
  };
}

function splitKeywords(text: string): string[] | undefined {
  const values = Array.from(new Set(
    text
      .split(/[,\n，、]/)
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => Array.from(item).slice(0, 24).join("")),
  )).slice(0, 12);
  return values.length > 0 ? values : undefined;
}

function memoryPayload(form: MemoryFormState) {
  return {
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    category: form.category,
    date: form.date || undefined,
    source: form.source as any,
    memoryType: form.memoryType as any,
    importance: Number(form.importance),
    confidence: Number(form.confidence),
    keywords: splitKeywords(form.keywords),
    emotion: form.emotion.trim() || undefined,
  };
}

function MemoryTimeline({ personaId, onClose }: { personaId: number; onClose: () => void }) {
  const { data: memories, refetch } = trpc.memory.list.useQuery({ personaId });
  const createMutation = trpc.memory.create.useMutation({
    onSuccess: () => {
      refetch();
      setShowAdd(false);
      setForm(emptyMemoryForm());
      toast.success("记忆已添加");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const updateMutation = trpc.memory.update.useMutation({
    onSuccess: () => {
      refetch();
      setEditingId(null);
      toast.success("记忆已更新");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMutation = trpc.memory.delete.useMutation({ onSuccess: () => refetch() });
  const extractMutation = trpc.memory.autoExtract.useMutation({
    onSuccess: (data) => { refetch(); toast.success(`提取了 ${data.extracted.length} 条记忆`); },
    onError: (e: any) => toast.error(e.message),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<MemoryFormState>(emptyMemoryForm());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  const filteredMemories = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (memories ?? []).filter((memory: any) => {
      if (statusFilter !== "all" && (memory.status || "active") !== statusFilter) return false;
      if (typeFilter !== "all" && (memory.memoryType || "relationship_event") !== typeFilter) return false;
      if (sourceFilter !== "all" && (memory.source || "manual") !== sourceFilter) return false;
      if (!q) return true;
      return [
        memory.title,
        memory.description,
        memory.date,
        memory.emotion,
        memory.memoryType,
        memory.source,
        keywordText(memory.keywords),
      ].filter(Boolean).join("\n").toLowerCase().includes(q);
    });
  }, [memories, query, statusFilter, typeFilter, sourceFilter]);

  const stats = useMemo(() => {
    const list = memories ?? [];
    return {
      total: list.length,
      active: list.filter((memory: any) => (memory.status || "active") === "active").length,
      lowConfidence: list.filter((memory: any) => (memory.confidence ?? 3) <= 2).length,
      highImportance: list.filter((memory: any) => (memory.importance ?? 3) >= 4).length,
    };
  }, [memories]);

  const startAdd = () => {
    setEditingId(null);
    setForm(emptyMemoryForm());
    setShowAdd(true);
  };

  const startEdit = (memory: any) => {
    setShowAdd(false);
    setEditingId(memory.id);
    setForm(memoryToForm(memory));
  };

  const cancelForm = () => {
    setShowAdd(false);
    setEditingId(null);
    setForm(emptyMemoryForm());
  };

  const saveForm = () => {
    if (!form.title.trim()) return;
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...memoryPayload(form), status: form.status });
    } else {
      createMutation.mutate({ personaId, ...memoryPayload(form) });
    }
  };

  const updateStatus = (memory: any, status: "active" | "archived" | "contradicted") => {
    updateMutation.mutate({
      id: memory.id,
      status,
      confidence: status === "contradicted" ? 1 : memory.confidence ?? 3,
    });
  };

  const selectedMemory = editingId ? (memories ?? []).find((memory: any) => memory.id === editingId) : null;
  const showingForm = showAdd || Boolean(editingId);
  const selectedEvidenceText = keywordText((selectedMemory as any)?.evidenceMessageIds);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-[min(96vw,42rem)] overflow-hidden bg-card border-l border-border h-full flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h3 className="font-medium text-foreground">记忆管理</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {stats.active} 条有效 / {stats.total} 条总计 / {stats.lowConfidence} 条低可信
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => extractMutation.mutate({ personaId })} disabled={extractMutation.isPending}
              className="text-xs px-3 py-1.5 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50">
              {extractMutation.isPending ? "提取中..." : "AI 提取"}
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="border-b border-border p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="搜索标题、描述、关键词"
              className="w-full h-10 pl-9 pr-3 bg-muted/40 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/40" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="h-9 px-2 bg-muted/40 border border-border rounded-lg text-xs text-foreground">
              <option value="all">全部状态</option>
              {MEMORY_STATUSES.map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
              className="h-9 px-2 bg-muted/40 border border-border rounded-lg text-xs text-foreground">
              <option value="all">全部类型</option>
              {MEMORY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
              className="h-9 px-2 bg-muted/40 border border-border rounded-lg text-xs text-foreground">
              <option value="all">全部来源</option>
              {MEMORY_SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {(!memories || memories.length === 0) && !showingForm && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>还没有记忆</p>
              <p className="text-xs mt-1">添加你们的重要时刻</p>
            </div>
          )}

          {showingForm && (
            <div className="p-3 bg-muted/35 rounded-xl border border-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  {editingId ? `编辑记忆 #${editingId}` : "添加记忆"}
                </span>
                <button onClick={cancelForm} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="标题"
                className="w-full h-9 px-3 bg-card/70 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/50 outline-none" />
              <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="描述"
                rows={4}
                className="w-full px-3 py-2 bg-card/70 border border-border rounded-lg text-xs text-foreground placeholder:text-muted-foreground/50 outline-none resize-none" />

              <div className="grid grid-cols-2 gap-2">
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as MemoryFormState["category"] }))}
                  className="h-9 px-2 bg-card/70 border border-border rounded-lg text-xs text-foreground">
                  <option value="memory">记忆</option>
                  <option value="milestone">里程碑</option>
                  <option value="anniversary">纪念日</option>
                </select>
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="h-9 px-2 bg-card/70 border border-border rounded-lg text-xs text-foreground" />
                <select value={form.memoryType} onChange={e => setForm(f => ({ ...f, memoryType: e.target.value }))}
                  className="h-9 px-2 bg-card/70 border border-border rounded-lg text-xs text-foreground">
                  {MEMORY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                  className="h-9 px-2 bg-card/70 border border-border rounded-lg text-xs text-foreground">
                  {MEMORY_SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as MemoryFormState["status"] }))}
                  className="h-9 px-2 bg-card/70 border border-border rounded-lg text-xs text-foreground">
                  {MEMORY_STATUSES.map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
                </select>
                <input value={form.emotion} onChange={e => setForm(f => ({ ...f, emotion: e.target.value }))}
                  placeholder="情绪色彩"
                  className="h-9 px-2 bg-card/70 border border-border rounded-lg text-xs text-foreground placeholder:text-muted-foreground/50 outline-none" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-muted-foreground space-y-1">
                  <span>重要度 {form.importance}</span>
                  <input type="range" min="1" max="5" value={form.importance}
                    onChange={e => setForm(f => ({ ...f, importance: Number(e.target.value) }))}
                    className="w-full accent-primary" />
                </label>
                <label className="text-xs text-muted-foreground space-y-1">
                  <span>可信度 {form.confidence}</span>
                  <input type="range" min="1" max="5" value={form.confidence}
                    onChange={e => setForm(f => ({ ...f, confidence: Number(e.target.value) }))}
                    className="w-full accent-primary" />
                </label>
              </div>

              <input value={form.keywords} onChange={e => setForm(f => ({ ...f, keywords: e.target.value }))}
                placeholder="关键词，用顿号或逗号分隔"
                className="w-full h-9 px-3 bg-card/70 border border-border rounded-lg text-xs text-foreground placeholder:text-muted-foreground/50 outline-none" />

              {selectedEvidenceText && (
                <p className="text-xs text-muted-foreground">
                  证据消息：{selectedEvidenceText}
                </p>
              )}

              <div className="flex gap-2 justify-end">
                <button onClick={cancelForm} className="text-xs px-3 py-1.5 text-muted-foreground hover:text-foreground">取消</button>
                <button onClick={saveForm}
                  disabled={!form.title.trim() || createMutation.isPending || updateMutation.isPending}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg disabled:opacity-50">
                  <Save className="w-3.5 h-3.5" />
                  保存
                </button>
              </div>
            </div>
          )}

          {filteredMemories.length === 0 && memories && memories.length > 0 && !showingForm && (
            <div className="text-center py-10 text-muted-foreground text-sm">
              <Filter className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>当前筛选没有结果</p>
            </div>
          )}

          <div className="space-y-3">
            {filteredMemories.map((m: any) => {
              const cat = CATEGORY_LABELS[m.category] || CATEGORY_LABELS.memory;
              const status = MEMORY_STATUS_LABELS[m.status || "active"] || MEMORY_STATUS_LABELS.active;
              const typeLabel = MEMORY_TYPE_LABELS[m.memoryType || "relationship_event"] || m.memoryType || "记忆";
              const sourceLabel = MEMORY_SOURCE_LABELS[m.source || "manual"] || m.source || "未知";
              const lowConfidence = (m.confidence ?? 3) <= 2;
              return (
                <div key={m.id} className="rounded-xl border border-border bg-card/70 p-3 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 w-2.5 h-2.5 rounded-full ${cat.color} flex-shrink-0`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${status.tone}`}>{status.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${cat.color}/10 text-foreground`}>{cat.label}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{typeLabel}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{sourceLabel}</span>
                        {m.date && <span className="text-xs text-muted-foreground">{m.date}</span>}
                      </div>
                      <p className="text-sm font-medium text-foreground mt-1">{m.title}</p>
                      {m.description && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{m.description}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                        <span>重要度 {m.importance ?? 3}</span>
                        <span className={lowConfidence ? "text-destructive" : ""}>可信度 {m.confidence ?? 3}</span>
                        {m.emotion && <span>{m.emotion}</span>}
                        {keywordText(m.keywords) && <span>关键词：{keywordText(m.keywords)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => startEdit(m)}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-muted hover:bg-muted/80 text-foreground">
                      <Pencil className="w-3.5 h-3.5" />
                      编辑
                    </button>
                    {(m.status || "active") !== "active" && (
                      <button onClick={() => updateStatus(m, "active")}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-600">
                        <RotateCcw className="w-3.5 h-3.5" />
                        恢复
                      </button>
                    )}
                    {(m.status || "active") === "active" && (
                      <>
                        <button onClick={() => updateStatus(m, "archived")}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground">
                          <Archive className="w-3.5 h-3.5" />
                          归档
                        </button>
                        <button onClick={() => updateStatus(m, "contradicted")}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-destructive/10 hover:bg-destructive/15 text-destructive">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          标错
                        </button>
                      </>
                    )}
                    <button onClick={() => deleteMutation.mutate({ id: m.id })}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                      <Trash2 className="w-3.5 h-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 border-t border-border grid grid-cols-2 gap-2">
          <button onClick={startAdd}
            className="inline-flex items-center justify-center gap-1.5 text-sm py-2 bg-muted hover:bg-muted/80 text-foreground rounded-xl transition-colors">
            <Plus className="w-4 h-4" />
            添加记忆
          </button>
          <button onClick={() => setStatusFilter("active")}
            className="inline-flex items-center justify-center gap-1.5 text-sm py-2 bg-primary/10 hover:bg-primary/15 text-primary rounded-xl transition-colors">
            <CheckCircle2 className="w-4 h-4" />
            只看有效
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SOURCE LIBRARY ──────────────────────────────────────────────────────────

function formatCount(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString("zh-CN") : "0";
}

function excerptText(text: string, limit = 180): string {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  const chars = Array.from(normalized);
  if (chars.length <= limit) return normalized;
  return `${chars.slice(0, limit).join("")}...`;
}

function SourceLibraryPanel({ personaId, onClose }: { personaId: number; onClose: () => void }) {
  const [queryInput, setQueryInput] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const { data, isLoading, refetch } = trpc.sourceLibrary.overview.useQuery({ personaId, query: submittedQuery });
  const sources = data?.sources ?? [];
  const results = data?.search?.results ?? [];

  const runSearch = () => setSubmittedQuery(queryInput.trim());
  const clearSearch = () => {
    setQueryInput("");
    setSubmittedQuery("");
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-[min(96vw,46rem)] overflow-hidden bg-card border-l border-border h-full flex flex-col animate-slide-in-right">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="min-w-0">
            <h3 className="font-medium text-foreground">资料库</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatCount(data?.stats?.sourceCount)} 个来源 / {formatCount(data?.stats?.chunkCount)} 个片段 / {formatCount(data?.stats?.chapterCount)} 个章节
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => refetch()} disabled={isLoading}
              className="text-xs px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground rounded-lg transition-colors disabled:opacity-50">
              刷新
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="border-b border-border p-4 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <div className="rounded-xl bg-muted/45 p-3">
              <p className="text-lg font-semibold text-foreground">{formatCount(data?.stats?.sourceCount)}</p>
              <p className="text-[11px] text-muted-foreground">来源</p>
            </div>
            <div className="rounded-xl bg-muted/45 p-3">
              <p className="text-lg font-semibold text-foreground">{formatCount(data?.stats?.chunkCount)}</p>
              <p className="text-[11px] text-muted-foreground">片段</p>
            </div>
            <div className="rounded-xl bg-muted/45 p-3">
              <p className="text-lg font-semibold text-foreground">{formatCount(data?.stats?.chapterCount)}</p>
              <p className="text-[11px] text-muted-foreground">章节</p>
            </div>
            <div className="rounded-xl bg-muted/45 p-3">
              <p className="text-lg font-semibold text-foreground">{formatCount(data?.stats?.tokenEstimate)}</p>
              <p className="text-[11px] text-muted-foreground">估算 tokens</p>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input value={queryInput} onChange={e => setQueryInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") runSearch(); }}
                placeholder="检索原著片段"
                className="w-full h-10 pl-9 pr-3 bg-muted/40 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary/40" />
            </div>
            <button onClick={runSearch}
              className="h-10 px-3 bg-primary text-primary-foreground rounded-xl text-sm disabled:opacity-50"
              disabled={!queryInput.trim()}>
              检索
            </button>
          </div>

          {Boolean(data?.topKeywords?.length) && (
            <div className="flex flex-wrap gap-1.5">
              {data!.topKeywords.slice(0, 12).map((keyword: string) => (
                <button key={keyword} onClick={() => { setQueryInput(keyword); setSubmittedQuery(keyword); }}
                  className="text-[11px] px-2 py-1 rounded-lg bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80">
                  {keyword}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {isLoading && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-40 animate-pulse" />
              <p>正在读取资料库</p>
            </div>
          )}

          {!isLoading && sources.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>还没有导入资料</p>
              <p className="text-xs mt-1">导入后会在这里显示来源、章节和检索命中</p>
            </div>
          )}

          {submittedQuery && !isLoading && (
            <section className="rounded-xl border border-border bg-muted/25 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">检索预览：{submittedQuery}</p>
                  <p className="text-xs text-muted-foreground">{results.length > 0 ? `命中 ${results.length} 个片段` : "没有命中可用片段"}</p>
                </div>
                <button onClick={clearSearch} className="text-xs text-muted-foreground hover:text-foreground">清除</button>
              </div>

              {results.length === 0 ? (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-700">
                  这类问题会进入“证据不足”回退：角色应承认记不准，不能用上一轮回答或大致剧情继续编。
                </div>
              ) : (
                <div className="space-y-2">
                  {results.map((chunk: any) => (
                    <div key={chunk.id} className="rounded-lg bg-card/70 border border-border p-3">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">{chunk.sourceTitle}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{chunk.chapterTitle || `片段 ${chunk.chunkIndex + 1}`}</span>
                        {chunk.distanceFromSeed > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">关联片段</span>
                        )}
                        <span className="text-[10px] text-muted-foreground">score {chunk.score}</span>
                      </div>
                      <p className="text-xs text-foreground leading-relaxed">{excerptText(chunk.content)}</p>
                      {Boolean(chunk.matchedTerms?.length) && (
                        <p className="text-[10px] text-muted-foreground mt-2">命中词：{keywordText(chunk.matchedTerms)}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {sources.map((source: any) => (
            <section key={source.id} className="rounded-xl border border-border bg-card/70 p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{source.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {source.sourceType} {source.originalName ? `· ${source.originalName}` : ""}
                  </p>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex-shrink-0">
                  #{source.id}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-muted/35 p-2">
                  <p className="text-sm font-semibold text-foreground">{formatCount(source.chunkCount)}</p>
                  <p className="text-[10px] text-muted-foreground">片段</p>
                </div>
                <div className="rounded-lg bg-muted/35 p-2">
                  <p className="text-sm font-semibold text-foreground">{formatCount(source.chapterCount)}</p>
                  <p className="text-[10px] text-muted-foreground">章节</p>
                </div>
                <div className="rounded-lg bg-muted/35 p-2">
                  <p className="text-sm font-semibold text-foreground">{formatCount(source.tokenEstimate)}</p>
                  <p className="text-[10px] text-muted-foreground">tokens</p>
                </div>
              </div>

              {Boolean(source.topKeywords?.length) && (
                <div className="flex flex-wrap gap-1.5">
                  {source.topKeywords.map((keyword: string) => (
                    <button key={keyword} onClick={() => { setQueryInput(keyword); setSubmittedQuery(keyword); }}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground hover:text-foreground">
                      {keyword}
                    </button>
                  ))}
                </div>
              )}

              {Boolean(source.chapters?.length) && (
                <div className="overflow-hidden rounded-lg border border-border/70 divide-y divide-border/50">
                  {source.chapters.map((chapter: any) => (
                    <div key={`${source.id}-${chapter.title}`} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                      <span className="text-foreground truncate">{chapter.title}</span>
                      <span className="text-muted-foreground flex-shrink-0">{formatCount(chapter.chunkCount)} 段</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="p-4 border-t border-border">
          <div className="rounded-xl bg-muted/35 border border-border p-3 text-xs text-muted-foreground leading-relaxed">
            重新导入和删除资料会影响召回证据与数据清理链路，本阶段先提供只读核查；写操作将随导出、删除和备份策略一起收口。
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── EMOTION REPORT ──────────────────────────────────────────────────────────

const STATE_COLORS: Record<string, string> = {
  warm: "var(--color-chart-1)", playful: "var(--color-chart-2)", nostalgic: "var(--color-chart-3)",
  melancholy: "var(--color-muted-foreground)", happy: "var(--color-chart-5)", distant: "var(--color-chart-4)",
};

function EmotionReport({ personaId, personaName, onClose }: { personaId: number; personaName: string; onClose: () => void }) {
  const [days, setDays] = useState(30);
  const { data: report } = trpc.emotion.getReport.useQuery({ personaId, days });

  const chartData = (report?.snapshots || []).map((s: any) => ({
    date: s.date,
    value: Object.keys(STATES).indexOf(s.emotionalState) + 1,
    state: s.emotionalState,
    label: STATES[s.emotionalState]?.label || s.emotionalState,
    messages: s.messageCount,
  }));

  const pieData = (report?.distribution || []).map((d: any) => ({
    name: STATES[d.emotionalState]?.label || d.emotionalState,
    value: Number(d.count),
    fill: STATE_COLORS[d.emotionalState] || "#999",
  }));

  const mostCommon = pieData.length > 0 ? pieData.reduce((a: any, b: any) => a.value > b.value ? a : b) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto animate-fade-in">
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10 rounded-t-2xl">
          <h3 className="font-medium text-foreground">{personaName} 的情绪报告</h3>
          <div className="flex items-center gap-2">
            <div className="flex bg-muted rounded-lg p-0.5">
              {[7, 30].map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`text-xs px-3 py-1 rounded-md transition-colors ${days === d ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                  {d}天
                </button>
              ))}
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="p-4 space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="text-2xl font-semibold text-foreground">{report?.totalDays || 0}</p>
              <p className="text-xs text-muted-foreground">聊天天数</p>
            </div>
            <div className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="text-2xl font-semibold text-foreground">{report?.totalMessages || 0}</p>
              <p className="text-xs text-muted-foreground">消息数</p>
            </div>
            <div className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="text-2xl font-semibold text-foreground">{mostCommon ? STATES[Object.keys(STATE_COLORS).find(k => STATE_COLORS[k] === mostCommon.fill) || ""]?.emoji || "🌸" : "—"}</p>
              <p className="text-xs text-muted-foreground">{mostCommon?.name || "暂无数据"}</p>
            </div>
          </div>

          {chartData.length > 0 ? (
            <>
              <div>
                <p className="text-sm font-medium text-foreground mb-3">情绪变化趋势</p>
                <div className="h-40 flex items-end gap-1">
                  {chartData.map((d: any, i: number) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.label} (${d.messages}条消息)`}>
                      <div className="w-full rounded-t-sm transition-all hover:opacity-80"
                        style={{ height: `${(d.value / 6) * 100}%`, backgroundColor: STATE_COLORS[d.state] || "#999", minHeight: "4px" }} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[10px] text-muted-foreground">{chartData[0]?.date}</span>
                  <span className="text-[10px] text-muted-foreground">{chartData[chartData.length - 1]?.date}</span>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-foreground mb-3">情绪分布</p>
                <div className="space-y-2">
                  {pieData.map((d: any) => {
                    const total = pieData.reduce((s: number, p: any) => s + p.value, 0);
                    const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                    return (
                      <div key={d.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                        <span className="text-xs text-foreground w-12">{d.name}</span>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: d.fill }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>暂无情绪数据</p>
              <p className="text-xs mt-1">多聊几天就会有数据了</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
