import { z } from "zod";
import { getPersistentLlmUsageDetails, getPersistentLlmUsageSnapshot, getPersonasByUserId } from "../db";
import { buildLlmEconomyPolicy } from "../llm/economy";
import { getLlmUsageDetails, getLlmUsageSnapshot } from "../llm/usage";
import { getQqBotStatus } from "../qq/onebot-client";
import { getLlmBudgetDiagnostics, getOperationsDiagnostics, getOperationsTroubleshootingDiagnostics } from "../social/output-diagnostics";
import { getBotStatus } from "../wechat/bot";
import { notifyOwner } from "./notification";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./trpc";

const llmUsageDetailsQueryInput = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.number().int().optional(),
  personaId: z.number().int().optional(),
  route: z.string().max(128).optional(),
  provider: z.string().max(64).optional(),
  purpose: z.string().max(64).optional(),
  success: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
const llmUsageDetailsInput = llmUsageDetailsQueryInput.optional();
type LlmUsageDetailsQueryInput = Partial<z.infer<typeof llmUsageDetailsQueryInput>>;

function optionalDate(value: string | undefined): Date | undefined {
  if (!value?.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  operationsDiagnostics: protectedProcedure.query(async ({ ctx }) => {
    const personas = await getPersonasByUserId(ctx.user.id);
    let persistentUsageError: string | null = null;
    const [qqStatus, persistentUsage] = await Promise.all([
      getQqBotStatus(),
      getPersistentLlmUsageSnapshot().catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        persistentUsageError = message;
        console.warn("[Diagnostics] Failed to read persistent LLM usage:", message);
        return null;
      }),
    ]);
    const wechatStatus = getBotStatus();
    const diagnostics = getOperationsDiagnostics({
      personas,
      cwd: process.cwd(),
    });
    const llmUsage = persistentUsage ?? {
      ...getLlmUsageSnapshot(),
      source: "in-memory-runtime",
    };

    return {
      ...diagnostics,
      llm: {
        ...diagnostics.llm,
        usage: llmUsage,
        budget: getLlmBudgetDiagnostics(llmUsage),
        economy: buildLlmEconomyPolicy(llmUsage),
      },
      live: {
        qq: qqStatus,
        wechat: wechatStatus,
      },
      troubleshooting: getOperationsTroubleshootingDiagnostics({
        database: diagnostics.database,
        qq: { config: diagnostics.qq, live: qqStatus },
        wechat: { config: diagnostics.wechat, live: wechatStatus },
        llmUsageReadError: persistentUsageError,
      }),
    };
  }),

  llmUsageDetails: protectedProcedure
    .input(llmUsageDetailsInput)
    .query(async ({ ctx, input }) => {
      const query: LlmUsageDetailsQueryInput = input ?? {};
      const limit = query.limit ?? 50;
      const userId = ctx.user.role === "admin" ? query.userId : ctx.user.id;
      const detailFilters = {
        from: optionalText(query.from),
        to: optionalText(query.to),
        userId,
        personaId: query.personaId,
        route: optionalText(query.route),
        provider: optionalText(query.provider),
        purpose: optionalText(query.purpose),
        success: query.success,
        limit,
      };

      try {
        const persistentDetails = await getPersistentLlmUsageDetails({
          from: optionalDate(query.from),
          to: optionalDate(query.to),
          userId,
          personaId: query.personaId,
          route: detailFilters.route,
          provider: detailFilters.provider,
          purpose: detailFilters.purpose,
          success: query.success,
          limit,
        });
        if (persistentDetails) return persistentDetails;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[Diagnostics] Failed to read persistent LLM usage details:", message);
      }

      return getLlmUsageDetails(detailFilters);
    }),
});
