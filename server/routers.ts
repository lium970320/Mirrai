import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { llmService, registry } from "./llm";
import type { InvokeParams, InvokeResult } from "./llm/types";
import { getTextContent } from "./llm/types";
import { storagePut } from "./storage";
import {
  createPersona, getPersonasByUserId, getPersonaById, updatePersona, deletePersona,
  getPersonasWithStats, getUserStats, getRecentActivity, getDailyChatCounts,
  createPersonaFile, getFilesByPersonaId,
  createMessage, getMessagesByPersonaId, clearMessagesByPersonaId, searchMessages,
  createQqBinding, getQqBindingsByUserId, deleteQqBinding,
  getSkillJobById, getLlmConfigsByUserId, upsertLlmConfig, setDefaultLlmConfig, getDefaultLlmConfig,
  updateUserProfile, updateUserPassword, deleteUserAccount, getAccountStats, exportUserData,
  getUserById,
  createMemory, getMemoriesByPersonaId, getActiveMemoriesByPersonaId, getPinnedMemoryFacts, updateMemory, deleteMemory,
  createEmotionSnapshot, getEmotionSnapshots, getEmotionReport, getTodaySnapshot,
  getIntimacyData, updateIntimacy,
  getMessageVolume, getEmotionTimeline, getPersonaEngagement, getHourlyDistribution, getAnalyticsStats,
  createDiaryEntry, getDiaryEntries, getDiaryByDate, deleteDiaryEntry, getMessagesByDate, getDiaryDates,
  getScenes, getSceneById, createScene, deleteScene, activateScene,
  getExportData, getRecentEmotionTrend, getMessageCountInRange, setGraduationStatus,
  getPersonaSourceLibraryStats, getPersonaSourceLibraryOverview,
  createRoleplayChannel, getRoleplayChannels, getRoleplayChannelById,
  getRoleplayChannelMessages, createRoleplayMessage, deleteRoleplayChannel,
} from "./db";
import { nanoid } from "nanoid";
import { maybeSendAmbientPresenceMessage } from "./social/ambient-proactive";
import { getQqBotStatus, parseQqContactId } from "./qq/onebot-client";
import { listRecentQqContacts } from "./qq/contact-registry";
import { runSkillPipeline } from "./skill-engine/pipeline";
import { getEmotionalStateDesc, buildSystemPrompt, computeIntimacy, checkGraduationEligibility } from "./_core/persona-utils";
import { buildEffectiveLifeScheduleOverlay, getActiveRuntimeLifeState, getPersonaScheduleState } from "./_core/life-schedule";
import { normalizePersonaProfileSections, withPersonaProfileSections } from "./_core/persona-profile";
import { getPersonaRuntimeState } from "./_core/persona-runtime";
import { handleSocialPersonaTextChatDetailed } from "./social/persona-text-chat";
import { handleSocialPersonaMediaChatDetailed } from "./social/persona-media-chat";
import { runRoleplayChannelTurn } from "./social/roleplay-channel";
import { parseStructuredMemoryCardsResponse, structuredMemoryToInsert } from "./social/memory-card";
import { getLlmUsageSnapshot } from "./llm/usage";
import { getOutputStrategyDiagnostics } from "./social/output-diagnostics";
import { defaultOutputPreferenceForPlatform } from "./social/runtime-request";

async function analyzeAndBuildPersona(
  personaId: number,
  userId: number,
  name: string,
  files: Array<{ fileType: string; fileUrl: string; extractedText?: string }>
): Promise<void> {
  await updatePersona(personaId, userId, { analysisStatus: "analyzing", analysisProgress: 10, analysisMessage: "正在读取文件内容..." });

  const chatContents: string[] = [];
  const imageUrls: string[] = [];

  for (const file of files) {
    if (file.fileType === "chat_txt" || file.fileType === "chat_csv") {
      if (file.extractedText) chatContents.push(file.extractedText);
    } else if (file.fileType === "image") {
      imageUrls.push(file.fileUrl);
    }
  }

  await updatePersona(personaId, userId, { analysisProgress: 30, analysisMessage: "AI 正在分析聊天记录..." });

  const chatSample = chatContents.join("\n\n---\n\n").slice(0, 8000);
  let personaData: any = {};

  try {
    const response = await llmService.invoke({
      messages: [
        { role: "system", content: "你是专业的人物性格分析师。请只返回 JSON，不要有其他文字。" },
        { role: "user", content: `请根据以下聊天记录，分析"${name}"的人物画像。\n\n聊天记录：\n${chatSample || "（无聊天记录，请根据名字生成温柔的默认人设）"}\n\n请返回JSON格式，包含以下字段：personality, speakingStyle, catchphrases(数组), nickname, memories, attachmentStyle, loveLanguage, conflictStyle, touchingMoments, summary` },
      ],
      options: { purpose: "persona_analysis", userId, personaId, route: "persona.analysis.text" },
    });
    const replyText = response;
    if (replyText) {
      const jsonMatch = replyText.match(/\{[\s\S]*\}/);
      if (jsonMatch) personaData = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("[Persona Analysis] LLM error:", e);
    personaData = { personality: `${name}是一个温柔体贴的人。`, speakingStyle: "说话温柔，喜欢用可爱的语气词", catchphrases: ["嗯嗯","好呀","哈哈"], nickname: "宝贝", memories: "我们一起走过了很多美好的时光", attachmentStyle: "安全型", loveLanguage: "精心时刻", conflictStyle: "会先冷静，然后主动和好", touchingMoments: "对方记住了自己说过的小细节", summary: `${name}是一个温暖、真诚的人` };
  }

  await updatePersona(personaId, userId, { analysisProgress: 70, analysisMessage: "正在分析图片内容..." });

  if (imageUrls.length > 0) {
    try {
      const imgResponse = await llmService.invoke({
        messages: [{
          role: "user",
          content: `这些是我和${name}的照片。请描述照片中体现的情感氛围和能反映${name}性格特质的细节。用中文，2-3句话。`,
        }],
        options: { purpose: "persona_analysis", userId, personaId, route: "persona.analysis.image" },
      });
      const imgMemory = imgResponse;
      if (imgMemory) {
        personaData.memories = (personaData.memories || "") + "\n\n【照片记忆】" + imgMemory;
      }
    } catch (e) { console.error("[Image Analysis] error:", e); }
  }

  await updatePersona(personaId, userId, {
    personaData: withPersonaProfileSections(personaData, { name }),
    analysisStatus: "ready",
    analysisProgress: 100,
    analysisMessage: `${name} 的数字分身已准备好，可以开始对话了`,
  });
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  user: router({
    getProfile: protectedProcedure.query(async ({ ctx }) => {
      const user = await getUserById(ctx.user.id);
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        loginMethod: user.loginMethod,
        createdAt: user.createdAt,
        lastSignedIn: user.lastSignedIn,
      };
    }),

    updateProfile: protectedProcedure
      .input(z.object({ name: z.string().min(1).max(100).optional(), email: z.string().email().max(320).optional() }))
      .mutation(async ({ ctx, input }) => {
        await updateUserProfile(ctx.user.id, input);
        return { success: true };
      }),

    changePassword: protectedProcedure
      .input(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6).max(128) }))
      .mutation(async ({ ctx, input }) => {
        const user = await getUserById(ctx.user.id);
        if (!user || !user.passwordHash) throw new TRPCError({ code: "BAD_REQUEST", message: "无法修改密码" });
        const { createHash } = await import("crypto");
        const [salt, storedHash] = user.passwordHash.split(":");
        const inputHash = createHash("sha256").update(input.currentPassword + salt).digest("hex");
        if (inputHash !== storedHash) throw new TRPCError({ code: "UNAUTHORIZED", message: "当前密码错误" });
        const { randomBytes } = await import("crypto");
        const newSalt = randomBytes(16).toString("hex");
        const newHash = createHash("sha256").update(input.newPassword + newSalt).digest("hex");
        await updateUserPassword(ctx.user.id, `${newSalt}:${newHash}`);
        return { success: true };
      }),

    getAccountStats: protectedProcedure.query(async ({ ctx }) => getAccountStats(ctx.user.id)),

    exportData: protectedProcedure.mutation(async ({ ctx }) => {
      const data = await exportUserData(ctx.user.id);
      return data;
    }),

    deleteAccount: protectedProcedure
      .input(z.object({ confirmPassword: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const user = await getUserById(ctx.user.id);
        if (!user || !user.passwordHash) throw new TRPCError({ code: "BAD_REQUEST" });
        const { createHash } = await import("crypto");
        const [salt, storedHash] = user.passwordHash.split(":");
        const inputHash = createHash("sha256").update(input.confirmPassword + salt).digest("hex");
        if (inputHash !== storedHash) throw new TRPCError({ code: "UNAUTHORIZED", message: "密码错误" });
        await deleteUserAccount(ctx.user.id);
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
        return { success: true };
      }),
  }),

  persona: router({
    list: protectedProcedure.query(async ({ ctx }) => getPersonasWithStats(ctx.user.id)),

    stats: protectedProcedure.query(async ({ ctx }) => getUserStats(ctx.user.id)),

    recentActivity: protectedProcedure.query(async ({ ctx }) => getRecentActivity(ctx.user.id)),

    dailyActivity: protectedProcedure.query(async ({ ctx }) => getDailyChatCounts(ctx.user.id)),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return persona;
      }),

    create: protectedProcedure
      .input(z.object({ name: z.string().min(1).max(100), relationshipDesc: z.string().max(200).optional(), togetherFrom: z.string().max(50).optional(), togetherTo: z.string().max(50).optional() }))
      .mutation(async ({ ctx, input }) => {
        const id = await createPersona({ userId: ctx.user.id, ...input, analysisStatus: "pending" });
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number(), name: z.string().min(1).max(100).optional(), relationshipDesc: z.string().max(200).optional(), togetherFrom: z.string().max(50).optional(), togetherTo: z.string().max(50).optional(), emotionalState: z.enum(["warm","playful","nostalgic","melancholy","happy","distant"]).optional(), llmProvider: z.string().max(64).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updatePersona(id, ctx.user.id, data);
        return { success: true };
      }),

    updatePersonaData: protectedProcedure
      .input(z.object({ id: z.number(), personaData: z.record(z.string(), z.any()) }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const merged = { ...((persona.personaData as any) || {}), ...input.personaData };
        await updatePersona(input.id, ctx.user.id, {
          personaData: withPersonaProfileSections(merged, {
            name: persona.name,
            relationshipDesc: persona.relationshipDesc,
            togetherFrom: persona.togetherFrom,
            togetherTo: persona.togetherTo,
          }),
        });
        return { success: true };
      }),

    getSystemPrompt: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const pinnedFacts = await getPinnedMemoryFacts(input.id, ctx.user.id).catch(() => []);
        return { prompt: buildSystemPrompt(persona, { pinnedFacts }) };
      }),

    getRuntimeState: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const personaData = (persona.personaData as Record<string, unknown> | null) || {};
        const personaRuntime = getPersonaRuntimeState(personaData);
        const sourceLibrary = await getPersonaSourceLibraryStats(input.id, ctx.user.id);
        const activeMemories = await getActiveMemoriesByPersonaId(input.id, ctx.user.id);
        const pinnedFacts = await getPinnedMemoryFacts(input.id, ctx.user.id).catch(() => []);
        const now = new Date();
        const recentlyAccessedMemories = [...activeMemories]
          .filter(memory => memory.lastAccessedAt)
          .sort((a, b) => new Date(b.lastAccessedAt as any).getTime() - new Date(a.lastAccessedAt as any).getTime())
          .slice(0, 6);
        const scheduleState = getPersonaScheduleState(now);
        return {
          personaId: persona.id,
          name: persona.name,
          emotionalState: persona.emotionalState,
          profileSections: normalizePersonaProfileSections(personaData, {
            name: persona.name,
            relationshipDesc: persona.relationshipDesc,
            togetherFrom: persona.togetherFrom,
            togetherTo: persona.togetherTo,
          }),
          scheduleState,
          runtimeLifeState: getActiveRuntimeLifeState(personaData, now),
          runtimeDiagnostics: personaRuntime.runtimeDiagnostics,
          personaRuntime,
          outputStrategy: getOutputStrategyDiagnostics(personaData),
          effectiveLifeOverlay: buildEffectiveLifeScheduleOverlay(personaData, now),
          sourceLibrary,
          memoryStats: {
            active: activeMemories.length,
            highImportance: activeMemories.filter(memory => (memory.importance ?? 3) >= 4).length,
            lowConfidence: activeMemories.filter(memory => (memory.confidence ?? 3) <= 2).length,
            recentlyAccessed: recentlyAccessedMemories.length,
            pinnedFacts: pinnedFacts.length,
          },
          pinnedFacts,
          recentlyAccessedMemories,
          personaDataKeys: Object.keys(personaData).sort(),
          architecture: {
            textRuntime: "server/social/persona-text-chat.ts",
            mediaRuntime: "server/social/persona-media-chat.ts",
            turnPlanner: "server/social/persona-turn-planner.ts",
            reflection: "server/social/persona-reflection.ts",
            memoryRecall: "server/social/memory-recall.ts",
            sourceRecall: "server/social/source-recall.ts",
            lifeSchedule: "server/_core/life-schedule.ts",
          },
          llmUsage: getLlmUsageSnapshot(),
          prompt: buildSystemPrompt(persona, { now, pinnedFacts }),
        };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deletePersona(input.id, ctx.user.id);
        return { success: true };
      }),

    getIntimacy: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const data = await getIntimacyData(input.id, ctx.user.id);
        const result = computeIntimacy(data);
        await updateIntimacy(input.id, ctx.user.id, result.score, result.level);
        const nextLevel = [
          { threshold: 0, name: "初识" }, { threshold: 100, name: "熟悉" },
          { threshold: 300, name: "亲密" }, { threshold: 600, name: "知己" },
          { threshold: 1000, name: "灵魂伴侣" },
        ];
        const currentIdx = nextLevel.findIndex(l => l.name === result.level);
        const next = nextLevel[currentIdx + 1];
        return { ...result, breakdown: data, nextLevel: next?.name || null, nextThreshold: next?.threshold || 1000 };
      }),

    getAnalysisStatus: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return { status: persona.analysisStatus, progress: persona.analysisProgress, message: persona.analysisMessage };
      }),

    triggerAnalysis: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const files = await getFilesByPersonaId(input.id);
        analyzeAndBuildPersona(input.id, ctx.user.id, persona.name, files.map((f) => ({ fileType: f.fileType, fileUrl: f.fileUrl, extractedText: f.extractedMemory || undefined }))).catch(async (e) => {
          console.error("[triggerAnalysis] error:", e);
          await updatePersona(input.id, ctx.user.id, { analysisStatus: "error", analysisMessage: "解析失败，请重试" });
        });
        return { success: true };
      }),

    checkGraduation: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.graduationStatus === "graduated") {
          return { eligible: false, status: "graduated" as const, farewellLetter: persona.farewellLetter };
        }
        if (persona.graduationStatus === "suggested") {
          return { eligible: true, status: "suggested" as const, farewellLetter: null };
        }
        const recentEmotions = await getRecentEmotionTrend(input.id, 14);
        const recentFreq = await getMessageCountInRange(input.id, 7, 0);
        const prevFreq = await getMessageCountInRange(input.id, 14, 7);
        const result = checkGraduationEligibility({
          intimacyLevel: persona.intimacyLevel,
          recentEmotions,
          chatCount: persona.chatCount,
          recentChatFrequency: recentFreq,
          previousChatFrequency: prevFreq,
        });
        if (result.eligible && !persona.graduationStatus) {
          await setGraduationStatus(input.id, ctx.user.id, "suggested");
        }
        return { eligible: result.eligible, status: (persona.graduationStatus || null) as string | null, reason: result.reason, farewellLetter: null };
      }),

    graduate: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const systemPrompt = buildSystemPrompt(persona);
        const response = await llmService.invoke({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `我们已经走过了很长的路，现在是时候说再见了。请用${persona.name}的口吻，写一封温暖的告别信。回顾我们的美好时光，表达祝福和不舍。信的长度在200-400字之间。只返回信的内容，不要有其他文字。` },
          ],
          options: { purpose: "graduation", userId: ctx.user.id, personaId: input.id, route: "persona.graduation" },
        });
        const farewellLetter = response || `亲爱的，感谢你一路的陪伴。虽然我们要说再见了，但那些美好的回忆会永远留在心里。祝你一切都好。—— ${persona.name}`;
        await setGraduationStatus(input.id, ctx.user.id, "graduated", farewellLetter);
        return { farewellLetter };
      }),

    declineGraduation: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await setGraduationStatus(input.id, ctx.user.id, "declined");
        return { success: true };
      }),

    awaken: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.graduationStatus !== "graduated") throw new TRPCError({ code: "BAD_REQUEST", message: "该分身未毕业" });
        await setGraduationStatus(input.id, ctx.user.id, null);
        return { success: true };
      }),
  }),

  file: router({
    upload: protectedProcedure
      .input(z.object({ personaId: z.number(), fileName: z.string(), fileType: z.enum(["chat_txt","chat_csv","image","video"]), fileSize: z.number(), fileContent: z.string(), mimeType: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const buffer = Buffer.from(input.fileContent, "base64");
        const fileKey = `personas/${ctx.user.id}/${input.personaId}/${nanoid()}-${input.fileName}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        let extractedText: string | undefined;
        if (input.fileType === "chat_txt" || input.fileType === "chat_csv") {
          extractedText = buffer.toString("utf-8").slice(0, 50000);
        }
        const fileId = await createPersonaFile({ personaId: input.personaId, userId: ctx.user.id, fileType: input.fileType, originalName: input.fileName, fileKey, fileUrl: url, fileSize: input.fileSize, extractedMemory: extractedText?.slice(0, 2000), processStatus: "done" });
        return { fileId, fileUrl: url };
      }),

    list: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getFilesByPersonaId(input.personaId);
      }),
  }),

  chat: router({
    getHistory: protectedProcedure
      .input(z.object({ personaId: z.number(), limit: z.number().default(50) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getMessagesByPersonaId(input.personaId, input.limit);
      }),

    send: protectedProcedure
      .input(z.object({ personaId: z.number(), message: z.string().min(1).max(2000) }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: "分身还未准备好，请先完成 AI 解析" });

        const scene = persona.activeSceneId ? await getSceneById(persona.activeSceneId) : null;
        const result = await handleSocialPersonaTextChatDetailed({
          platform: "web",
          binding: {
            personaId: input.personaId,
            userId: ctx.user.id,
          },
          contactName: ctx.user.name || ctx.user.username || "用户",
          messageText: input.message,
          channel: "web",
          sceneOverlay: scene?.systemPromptOverlay,
          outputPreference: defaultOutputPreferenceForPlatform("web"),
        });
        if (!result) {
          return {
            reply: "",
            emotionalState: persona.emotionalState,
            graduationSuggested: false,
            suppressed: true,
          };
        }

        const todayStr = new Date().toISOString().slice(0, 10);
        const existing = await getTodaySnapshot(input.personaId, ctx.user.id);
        if (!existing) {
          await createEmotionSnapshot({ personaId: input.personaId, userId: ctx.user.id, emotionalState: result.emotionalState, messageCount: 1, date: todayStr });
        }

        const intimacyData = await getIntimacyData(input.personaId, ctx.user.id);
        const intimacy = computeIntimacy(intimacyData);
        await updateIntimacy(input.personaId, ctx.user.id, intimacy.score, intimacy.level);

        let graduationSuggested = false;
        if (intimacy.level === "灵魂伴侣" && !persona.graduationStatus) {
          const recentEmotions = await getRecentEmotionTrend(input.personaId, 14);
          const recentFreq = await getMessageCountInRange(input.personaId, 7, 0);
          const prevFreq = await getMessageCountInRange(input.personaId, 14, 7);
          const gradResult = checkGraduationEligibility({
            intimacyLevel: intimacy.level,
            recentEmotions,
            chatCount: (persona.chatCount || 0) + 1,
            recentChatFrequency: recentFreq,
            previousChatFrequency: prevFreq,
          });
          if (gradResult.eligible) {
            await setGraduationStatus(input.personaId, ctx.user.id, "suggested");
            graduationSuggested = true;
          }
        }

        return {
          reply: result.replyText,
          emotionalState: result.emotionalState,
          graduationSuggested,
          turnPlan: result.turnPlan,
          sourceRecallUsed: result.sourceRecallUsed,
        };
      }),

    sendImage: protectedProcedure
      .input(z.object({ personaId: z.number(), imageContent: z.string(), fileName: z.string(), mimeType: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: "分身还未准备好" });

        const scene = persona.activeSceneId ? await getSceneById(persona.activeSceneId) : null;
        const buffer = Buffer.from(input.imageContent, "base64");
        const result = await handleSocialPersonaMediaChatDetailed({
          platform: "web",
          binding: {
            personaId: input.personaId,
            userId: ctx.user.id,
          },
          contactName: ctx.user.name || ctx.user.username || "用户",
          media: {
            kind: "image",
            buffer,
            fileName: input.fileName,
            mimeType: input.mimeType,
          },
          channel: "web",
          storagePrefix: "chat",
          sceneOverlay: scene?.systemPromptOverlay,
          outputPreference: defaultOutputPreferenceForPlatform("web"),
        });
        if (!result) {
          return {
            reply: "",
            emotionalState: persona.emotionalState,
            imageUrl: undefined,
            suppressed: true,
          };
        }

        return { reply: result.replyText, emotionalState: result.emotionalState, imageUrl: result.mediaUrl };
      }),

    sendVoice: protectedProcedure
      .input(z.object({ personaId: z.number(), audioContent: z.string(), duration: z.number(), fileName: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: "分身还未准备好" });

        const buffer = Buffer.from(input.audioContent, "base64");
        const fileKey = `chat/${ctx.user.id}/${input.personaId}/${nanoid()}-${input.fileName}`;
        const { url } = await storagePut(fileKey, buffer, "audio/webm");

        const transcription = "";
        const replyText = "这条语音我暂时没听清。你可以打字跟我说，或者再发一次。";

        await createMessage({
          personaId: input.personaId,
          userId: ctx.user.id,
          role: "user",
          content: "（网页语音消息，暂未转写）",
          messageType: "voice",
          mediaUrl: url,
          mediaDuration: input.duration,
          emotionalState: persona.emotionalState,
        });
        await createMessage({
          personaId: input.personaId,
          userId: ctx.user.id,
          role: "assistant",
          content: replyText,
          emotionalState: persona.emotionalState,
        });

        return { reply: replyText, emotionalState: persona.emotionalState, transcription, voiceUrl: url };
      }),

    clear: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await clearMessagesByPersonaId(input.personaId, ctx.user.id);
        return { success: true };
      }),

    search: protectedProcedure
      .input(z.object({ personaId: z.number(), query: z.string().min(1).max(200), limit: z.number().default(50) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return searchMessages(input.personaId, ctx.user.id, input.query, input.limit);
      }),

    tts: protectedProcedure
      .input(z.object({ text: z.string().min(1).max(500), voice: z.string().max(64).optional() }))
      .mutation(async ({ input }) => {
        const { generateTTS } = await import("./_core/tts");
        const audioUrl = await generateTTS(input.text, input.voice);
        return { audioUrl };
      }),

    export: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const data = await getExportData(input.personaId, ctx.user.id);
        if (!data) throw new TRPCError({ code: "NOT_FOUND" });
        const intimacyData = await getIntimacyData(input.personaId, ctx.user.id);
        const intimacy = computeIntimacy(intimacyData);
        const { generateChatExportHTML } = await import("./_core/export-html");
        const html = generateChatExportHTML({
          persona: data.persona,
          messages: data.messages,
          memories: data.memories,
          emotionSnapshots: data.emotionSnapshots,
          diaryEntries: data.diaryEntries,
          intimacy,
        });
        return { html, fileName: `${data.persona.name}-对话记录.html` };
      }),
  }),

  qq: router({
    getStatus: protectedProcedure.query(() => getQqBotStatus()),

    maybeSendAmbientPresence: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        eventText: z.string().min(1).max(120),
        force: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return maybeSendAmbientPresenceMessage(input.personaId, ctx.user.id, input.eventText, {
          force: input.force,
        });
      }),

    recentContacts: protectedProcedure.query(async ({ ctx }) => {
      const recent = listRecentQqContacts();
      const byId = new Map(recent.map(contact => [contact.id, contact]));
      const bindings = await getQqBindingsByUserId(ctx.user.id);

      for (const binding of bindings) {
        const contactId = binding.wechatContactId;
        if (!contactId || byId.has(contactId)) continue;
        const parsed = parseQqContactId(contactId);
        byId.set(contactId, {
          id: contactId,
          name: binding.wechatName || contactId,
          kind: parsed?.kind ?? "private",
          lastMessageAt: binding.createdAt instanceof Date
            ? binding.createdAt.toISOString()
            : new Date(binding.createdAt || Date.now()).toISOString(),
          lastMessagePreview: "已绑定联系人",
        });
      }

      return Array.from(byId.values())
        .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
    }),

    bindContact: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        qqContactId: z.string().min(1),
        qqName: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // 校验 persona 归属，避免把 QQ 联系人绑定到他人分身上（一致性 / 失效安全）。
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const id = await createQqBinding({
          personaId: input.personaId,
          userId: ctx.user.id,
          qqContactId: input.qqContactId,
          qqName: input.qqName ?? null,
        });
        return { id };
      }),

    unbindContact: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteQqBinding(input.id, ctx.user.id);
        return { success: true };
      }),

    listBindings: protectedProcedure.query(async ({ ctx }) =>
      getQqBindingsByUserId(ctx.user.id)
    ),
  }),

  skillEngine: router({
    startPipeline: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        characterFamily: z.enum(["colleague", "relationship", "celebrity"]).default("relationship"),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const files = await getFilesByPersonaId(input.personaId);
        const chatContent = files
          .filter(f => f.fileType === "chat_txt" || f.fileType === "chat_csv")
          .map(f => f.extractedMemory || "")
          .join("\n\n---\n\n");

        await updatePersona(input.personaId, ctx.user.id, {
          analysisStatus: "analyzing",
          analysisProgress: 5,
          analysisMessage: "启动性格蒸馏引擎...",
        });

        runSkillPipeline({
          personaId: input.personaId,
          userId: ctx.user.id,
          characterFamily: input.characterFamily,
          name: persona.name,
          chatContent,
        }).catch(e => console.error("[SkillEngine] Pipeline error:", e));

        return { success: true };
      }),

    getJobStatus: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await getSkillJobById(input.jobId, ctx.user.id);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        return job;
      }),
  }),

  llmConfig: router({
    list: protectedProcedure.query(async ({ ctx }) =>
      getLlmConfigsByUserId(ctx.user.id)
    ),

    getDefault: protectedProcedure.query(async ({ ctx }) =>
      getDefaultLlmConfig(ctx.user.id)
    ),

    listProviders: protectedProcedure.query(() => registry.list()),

    upsert: protectedProcedure
      .input(z.object({
        providerName: z.string().min(1),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        model: z.string().optional(),
        extraConfig: z.record(z.string(), z.any()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await upsertLlmConfig(ctx.user.id, input);
        return { id };
      }),

    updateExtraConfig: protectedProcedure
      .input(z.object({ extraConfig: z.record(z.string(), z.any()) }))
      .mutation(async ({ ctx, input }) => {
        const config = await getDefaultLlmConfig(ctx.user.id);
        if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "请先配置默认 LLM 提供商" });
        const merged = { ...((config.extraConfig as any) || {}), ...input.extraConfig };
        await upsertLlmConfig(ctx.user.id, { providerName: config.providerName, extraConfig: merged });
        return { success: true };
      }),

    setDefault: protectedProcedure
      .input(z.object({ providerName: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await setDefaultLlmConfig(ctx.user.id, input.providerName);
        return { success: true };
      }),
  }),

  memory: router({
    list: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getMemoriesByPersonaId(input.personaId, ctx.user.id);
      }),

    create: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        category: z.enum(["milestone", "memory", "anniversary"]).default("memory"),
        date: z.string().max(50).optional(),
        source: z.enum(["manual", "chat", "daily_summary", "source_material", "import", "system"]).default("manual"),
        memoryType: z.enum([
          "user_fact",
          "relationship_event",
          "promise",
          "preference",
          "emotional_moment",
          "conflict",
          "open_loop",
          "persona_background",
          "source_fact",
          "daily_summary",
        ]).default("relationship_event"),
        importance: z.number().int().min(1).max(5).default(3),
        confidence: z.number().int().min(1).max(5).default(3),
        keywords: z.array(z.string().min(1).max(24)).max(12).optional(),
        emotion: z.string().max(50).optional(),
        validFrom: z.string().max(50).optional(),
        validTo: z.string().max(50).optional(),
        evidenceMessageIds: z.array(z.number().int().positive()).max(80).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const id = await createMemory({ ...input, userId: ctx.user.id });
        return { id };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteMemory(input.id, ctx.user.id);
        return { success: true };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        category: z.enum(["milestone", "memory", "anniversary"]).optional(),
        date: z.string().max(50).optional(),
        source: z.enum(["manual", "chat", "daily_summary", "source_material", "import", "system"]).optional(),
        memoryType: z.enum([
          "user_fact",
          "relationship_event",
          "promise",
          "preference",
          "emotional_moment",
          "conflict",
          "open_loop",
          "persona_background",
          "source_fact",
          "daily_summary",
        ]).optional(),
        importance: z.number().int().min(1).max(5).optional(),
        confidence: z.number().int().min(1).max(5).optional(),
        keywords: z.array(z.string().min(1).max(24)).max(12).optional(),
        emotion: z.string().max(50).optional(),
        validFrom: z.string().max(50).optional(),
        validTo: z.string().max(50).optional(),
        evidenceMessageIds: z.array(z.number().int().positive()).max(80).optional(),
        status: z.enum(["active", "archived", "contradicted"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        await updateMemory(id, ctx.user.id, data);
        return { success: true };
      }),

    autoExtract: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const history = await getMessagesByPersonaId(input.personaId, 50);
        if (history.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "没有聊天记录可供提取" });

        const chatText = history.map(m => `${m.role === "user" ? "用户" : persona.name}: ${m.content}`).join("\n");
        const response = await llmService.invoke({
          messages: [
            { role: "system", content: "你是长期记忆提取助手。只提取未来对话真正需要记住的信息，必须返回严格 JSON，不要 Markdown。" },
            {
              role: "user",
              content: [
                "请从以下对话中提取最多 6 条长期记忆卡片。",
                "不要记录普通寒暄、重复催睡、无信息量闲聊。",
                "memoryType 只能使用：user_fact, relationship_event, promise, preference, emotional_moment, conflict, open_loop。",
                "importance 和 confidence 都是 1-5。confidence 低代表只是推测，不要把推测写成事实。",
                '返回格式：{"memories":[{"title":"不超过40字","description":"80-300字","memoryType":"relationship_event","category":"memory","date":"YYYY-MM-DD或空","importance":4,"confidence":4,"keywords":["关键词"],"emotion":"心情词"}]}',
                "",
                "对话：",
                chatText,
              ].join("\n"),
            },
          ],
          options: { purpose: "memory_extract", userId: ctx.user.id, personaId: input.personaId, route: "memory.auto_extract" },
        });

        const extracted: Array<{ title: string; description?: string; category?: string; date?: string }> = [];
        try {
          const evidenceMessageIds = history.map(message => message.id).slice(-80);
          const cards = parseStructuredMemoryCardsResponse(response || "", {
            source: "chat",
            memoryType: "relationship_event",
            category: "memory",
            evidenceMessageIds,
          }, 6);
          for (const card of cards) {
            const id = await createMemory(structuredMemoryToInsert(card, input.personaId, ctx.user.id));
            extracted.push({ ...card, title: card.title, id } as any);
          }
        } catch (e) { console.error("[autoExtract] parse error:", e); }

        return { extracted };
      }),
  }),

  sourceLibrary: router({
    overview: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        query: z.string().max(120).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getPersonaSourceLibraryOverview(input.personaId, ctx.user.id, input.query ?? "");
      }),
  }),

  emotion: router({
    getReport: protectedProcedure
      .input(z.object({ personaId: z.number(), days: z.number().default(30) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getEmotionReport(input.personaId, input.days);
      }),

    getDailySnapshots: protectedProcedure
      .input(z.object({ personaId: z.number(), days: z.number().default(30) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getEmotionSnapshots(input.personaId, input.days);
      }),
  }),

  diary: router({
    list: protectedProcedure
      .input(z.object({ personaId: z.number().optional(), limit: z.number().default(30) }))
      .query(async ({ ctx, input }) => getDiaryEntries(ctx.user.id, input.personaId, input.limit)),

    getByDate: protectedProcedure
      .input(z.object({ personaId: z.number(), date: z.string() }))
      .query(async ({ ctx, input }) => getDiaryByDate(input.personaId, ctx.user.id, input.date)),

    getDates: protectedProcedure
      .input(z.object({ personaId: z.number().optional() }))
      .query(async ({ ctx, input }) => getDiaryDates(ctx.user.id, input.personaId)),

    generate: protectedProcedure
      .input(z.object({ personaId: z.number(), date: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const date = input.date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "日期格式无效，需要 YYYY-MM-DD" });
        }
        const today = new Date().toISOString().slice(0, 10);
        if (date > today) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "不能为未来日期生成日记" });
        }
        const existing = await getDiaryByDate(input.personaId, ctx.user.id, date);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "该日期已有日记" });
        const msgs = await getMessagesByDate(input.personaId, ctx.user.id, date);
        if (msgs.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "该日期没有聊天记录" });
        const chatText = msgs.map(m => `${m.role === "user" ? "用户" : persona.name}: ${m.content || ""}`).join("\n");
        if (!chatText.trim()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "该日期的聊天记录内容为空" });
        }
        const response = await llmService.invoke({
          messages: [
            { role: "system", content: '你是日记助手。请根据对话记录生成一篇温暖的日记。只返回JSON：{"summary":"2-3句概述","highlights":["亮点1","亮点2"],"emotionalArc":{"start":"开始情绪","end":"结束情绪","dominant":"主导情绪"},"quotes":["原话1","原话2"],"reflection":"温暖的反思1-2句"}' },
            { role: "user", content: chatText.slice(0, 6000) },
          ],
          options: { purpose: "diary", userId: ctx.user.id, personaId: input.personaId, route: "diary.generate" },
        });
        let parsed: any = {};
        try {
          const match = (response || "").match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        } catch {}
        const id = await createDiaryEntry({
          personaId: input.personaId, userId: ctx.user.id, date,
          summary: parsed.summary || "今天和TA聊了天",
          highlights: parsed.highlights || [],
          emotionalArc: parsed.emotionalArc || {},
          quotes: parsed.quotes || [],
          reflection: parsed.reflection || null,
          messageCount: msgs.length,
        });
        return { id };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteDiaryEntry(input.id, ctx.user.id);
        return { success: true };
      }),
  }),

  roleplay: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getRoleplayChannels(ctx.user.id);
    }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(1000).optional(),
        scenePrompt: z.string().max(3000).optional(),
        memberPersonaIds: z.array(z.number()).min(2).max(8),
      }))
      .mutation(async ({ ctx, input }) => {
        const memberPersonaIds = Array.from(new Set(input.memberPersonaIds));
        if (memberPersonaIds.length < 2) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "角色频道至少需要两个不同人物" });
        }
        for (const personaId of memberPersonaIds) {
          const persona = await getPersonaById(personaId, ctx.user.id);
          if (!persona) throw new TRPCError({ code: "NOT_FOUND", message: `人物 ${personaId} 不存在` });
          if (persona.analysisStatus !== "ready") {
            throw new TRPCError({ code: "BAD_REQUEST", message: `${persona.name} 还未准备好，不能加入角色频道` });
          }
        }

        const id = await createRoleplayChannel({
          userId: ctx.user.id,
          name: input.name,
          description: input.description ?? null,
          scenePrompt: input.scenePrompt ?? null,
          isActive: true,
        }, memberPersonaIds);
        return { id };
      }),

    get: protectedProcedure
      .input(z.object({ channelId: z.number(), limit: z.number().default(80) }))
      .query(async ({ ctx, input }) => {
        const channel = await getRoleplayChannelById(input.channelId, ctx.user.id);
        if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
        const messages = await getRoleplayChannelMessages(input.channelId, ctx.user.id, input.limit);
        return { channel, messages };
      }),

    postUserMessage: protectedProcedure
      .input(z.object({
        channelId: z.number(),
        content: z.string().min(1).max(4000),
        speakerName: z.string().max(100).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const channel = await getRoleplayChannelById(input.channelId, ctx.user.id);
        if (!channel) throw new TRPCError({ code: "NOT_FOUND" });
        const message = await createRoleplayMessage({
          channelId: input.channelId,
          userId: ctx.user.id,
          personaId: null,
          speakerName: input.speakerName?.trim() || ctx.user.name || ctx.user.username || "用户",
          role: "user",
          content: input.content,
          turnKind: "user_note",
        });
        return { message };
      }),

    tick: protectedProcedure
      .input(z.object({
        channelId: z.number(),
        personaId: z.number().optional(),
        allowSilence: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          return await runRoleplayChannelTurn({
            channelId: input.channelId,
            userId: ctx.user.id,
            personaId: input.personaId,
            allowSilence: input.allowSilence,
          });
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err instanceof Error ? err.message : "角色频道轮转失败",
          });
        }
      }),

    delete: protectedProcedure
      .input(z.object({ channelId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteRoleplayChannel(input.channelId, ctx.user.id);
        return { success: true };
      }),
  }),

  scene: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getScenes(ctx.user.id);
    }),

    create: protectedProcedure
      .input(z.object({ name: z.string().min(1).max(100), description: z.string().optional(), icon: z.string().max(10).optional(), systemPromptOverlay: z.string().optional(), emotionalState: z.string().optional(), starters: z.array(z.string()).optional() }))
      .mutation(async ({ ctx, input }) => {
        return createScene({ ...input, userId: ctx.user.id, starters: input.starters || [], isBuiltin: false });
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteScene(input.id, ctx.user.id);
        return { success: true };
      }),

    activate: protectedProcedure
      .input(z.object({ personaId: z.number(), sceneId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        // 校验场景归属：内置场景或本人创建的场景才允许激活，
        // 否则可激活并把他人私有 systemPromptOverlay 注入自己的对话（越权 + 提示注入）。
        const scene = await getSceneById(input.sceneId);
        if (!scene || (!scene.isBuiltin && scene.userId !== ctx.user.id)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        await activateScene(input.personaId, input.sceneId);
        return { success: true };
      }),

    deactivate: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        await activateScene(input.personaId, null);
        return { success: true };
      }),
  }),

  analytics: router({
    overview: protectedProcedure
      .input(z.object({ days: z.number().default(30) }))
      .query(async ({ ctx, input }) => {
        const [stats, messageVolume, emotionTimeline, personaEngagement, hourlyDistribution] = await Promise.all([
          getAnalyticsStats(ctx.user.id, input.days),
          getMessageVolume(ctx.user.id, input.days),
          getEmotionTimeline(ctx.user.id, input.days),
          getPersonaEngagement(ctx.user.id, input.days),
          getHourlyDistribution(ctx.user.id, input.days),
        ]);
        return { stats, messageVolume, emotionTimeline, personaEngagement, hourlyDistribution };
      }),
  }),
});

export type AppRouter = typeof appRouter;
