import { WechatyBuilder, ScanStatus } from "wechaty";
import type { WechatyInterface } from "wechaty/impls";
import fs from "fs";
import path from "path";
import { ENV } from "../_core/env";
import { handleWeChatMessage } from "./message-handler";
import { sayWeChatReply } from "./reply-sender";
import {
  getWechatSyncCircuitBreakerMessage,
  getWechatSyncCircuitBreakerReason,
  hasUsableMemoryCard,
  isWechat4uPuppet,
  normalizeErrorMessage,
  type WeChatSyncCircuitBreakerReason,
} from "./sync-circuit-breaker";

type BotStatus = "stopped" | "starting" | "scanning" | "logged_in" | "error";

type BotLastError = {
  code: string;
  message: string;
  detail?: string;
  at: string;
  circuitBreaker: boolean;
};

let bot: WechatyInterface | null = null;
let currentQrUrl: string | null = null;
let botStatus: BotStatus = "stopped";
let loggedInUser: string | null = null;
let lastError: BotLastError | null = null;
let syncCircuitBreakerTripped = false;
let stopInProgress = false;

function getMemoryName() {
  return path.join(ENV.wechatSessionDir, ENV.wechatBotName);
}

function getMemoryFilePath() {
  const memoryName = getMemoryName();
  return /\.memory-card\.json$/.test(memoryName) ? memoryName : `${memoryName}.memory-card.json`;
}

function prepareMemoryCard() {
  fs.mkdirSync(ENV.wechatSessionDir, { recursive: true });

  const memoryName = getMemoryName();
  const memoryFilePath = getMemoryFilePath();
  const legacyMemoryFilePath = path.resolve(process.cwd(), `${ENV.wechatBotName}.memory-card.json`);

  if (!fs.existsSync(memoryFilePath) && fs.existsSync(legacyMemoryFilePath)) {
    fs.copyFileSync(legacyMemoryFilePath, memoryFilePath);
    console.log(`[WeChat] Migrated stored login session to ${memoryFilePath}`);
  }
  if (
    fs.existsSync(memoryFilePath) &&
    fs.existsSync(legacyMemoryFilePath) &&
    path.resolve(memoryFilePath) !== legacyMemoryFilePath
  ) {
    fs.unlinkSync(legacyMemoryFilePath);
    console.log("[WeChat] Removed legacy login session file from run root");
  }

  return {
    memoryFilePath,
    memoryName,
    hasStoredSession: hasUsableMemoryCard(memoryFilePath),
  };
}

export function getBotStatus() {
  return {
    status: botStatus,
    qrCodeUrl: currentQrUrl,
    loggedInUser,
    hasStoredSession: hasUsableMemoryCard(getMemoryFilePath()),
    lastError: lastError
      ? {
          code: lastError.code,
          message: lastError.message,
          at: lastError.at,
          circuitBreaker: lastError.circuitBreaker,
        }
      : null,
    syncCircuitBreakerTripped,
  };
}

function setBotError(code: string, message: string, detail?: string, circuitBreaker = false) {
  lastError = {
    code,
    message,
    detail,
    at: new Date().toISOString(),
    circuitBreaker,
  };
}

function clearBotError() {
  lastError = null;
  syncCircuitBreakerTripped = false;
}

async function stopCurrentBot(finalStatus: BotStatus) {
  const targetBot = bot;
  bot = null;
  stopInProgress = true;

  if (targetBot) {
    try {
      await targetBot.stop();
    } catch (e) {
      console.error("[WeChat] Bot stop error:", e);
    }
  }

  stopInProgress = false;
  botStatus = finalStatus;
  currentQrUrl = null;
  loggedInUser = null;
}

function tripSyncCircuitBreaker(reason: WeChatSyncCircuitBreakerReason, error: unknown) {
  if (syncCircuitBreakerTripped) return;

  const message = getWechatSyncCircuitBreakerMessage(reason);
  syncCircuitBreakerTripped = true;
  botStatus = "error";
  currentQrUrl = null;
  setBotError(reason, message, normalizeErrorMessage(error), true);

  console.warn(`[WeChat] Sync circuit breaker tripped: ${message}`);
  void stopCurrentBot("error");
}

async function prepareContact(contact: any) {
  if (!contact) return null;
  if (typeof contact.ready === "function") await contact.ready();
  return contact;
}

export async function sendWeChatText(contactId: string, text: string, contactName?: string | null): Promise<boolean> {
  if (!bot || botStatus !== "logged_in") {
    console.warn(`[WeChat] Cannot send proactive message; bot status is ${botStatus}`);
    return false;
  }

  const contactApi = (bot as any).Contact;
  let contact: any = null;

  try {
    contact = await prepareContact(contactApi?.load ? contactApi.load(contactId) : await contactApi?.find?.({ id: contactId }));
  } catch (error) {
    console.warn(`[WeChat] Contact id ${contactId} is not available in current session; trying name fallback`, error);
  }

  if (!contact && contactName) {
    try {
      contact = await prepareContact(await contactApi?.find?.({ name: contactName }));
    } catch (error) {
      console.warn(`[WeChat] Contact name fallback failed for ${contactName}:`, error);
    }
  }

  if (!contact) {
    console.warn(`[WeChat] Contact not found for id ${contactId}${contactName ? ` or name ${contactName}` : ""}`);
    return false;
  }

  try {
    const messageCount = await sayWeChatReply(contact, text);
    botStatus = "logged_in";
    console.log(`[WeChat] Sent proactive message to ${contactName || contactId} (${messageCount} chunk${messageCount === 1 ? "" : "s"})`);
    return true;
  } catch (error) {
    console.error(`[WeChat] Failed to send proactive message to ${contactName || contactId}:`, error);
    return false;
  }
}

export function startWeChatBot() {
  if (bot || stopInProgress) return;

  const CHROME_BIN = process.env.CHROME_BIN ? { endpoint: process.env.CHROME_BIN } : {};
  const { memoryName, hasStoredSession } = prepareMemoryCard();
  botStatus = "starting";
  currentQrUrl = null;
  clearBotError();

  bot = WechatyBuilder.build({
    name: memoryName,
    puppet: ENV.wechatPuppet as any,
    puppetOptions: { uos: true, ...CHROME_BIN },
  });
  const activeBot = bot;

  console.log(hasStoredSession
    ? "[WeChat] Stored login session found; attempting automatic login"
    : "[WeChat] No stored login session; scan is required");

  bot.on("scan", (qrcode: string, status: number) => {
    if (bot !== activeBot) return;
    if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
      currentQrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrcode)}`;
      botStatus = "scanning";
      console.log("[WeChat] Scan QR:", currentQrUrl);
    }
  });

  bot.on("login", (user: any) => {
    if (bot !== activeBot) return;
    loggedInUser = user.name();
    botStatus = "logged_in";
    currentQrUrl = null;
    lastError = null;
    console.log(`[WeChat] ${loggedInUser} logged in`);
  });

  bot.on("logout", (user: any) => {
    if (bot !== activeBot) return;
    loggedInUser = null;
    botStatus = "stopped";
    currentQrUrl = null;
    console.log(`[WeChat] ${user.name()} logged out`);
  });

  bot.on("message", async (msg: any) => {
    try {
      if (bot !== activeBot) return;
      if (loggedInUser && botStatus === "error") {
        botStatus = "logged_in";
      }
      await handleWeChatMessage(msg, bot!);
    } catch (e) {
      console.error("[WeChat] Message handler error:", e);
    }
  });

  bot.on("error", (e: Error) => {
    if (bot !== activeBot) return;
    console.error("[WeChat] Bot error:", e);
    if (isWechat4uPuppet(ENV.wechatPuppet)) {
      const circuitBreakerReason = getWechatSyncCircuitBreakerReason(e);
      if (circuitBreakerReason) {
        tripSyncCircuitBreaker(circuitBreakerReason, e);
        return;
      }
    }
    setBotError("wechat_bot_error", "微信机器人运行出错。", normalizeErrorMessage(e));
    if (!loggedInUser) {
      botStatus = "error";
    }
  });

  bot.start()
    .then(() => {
      if (bot !== activeBot) return;
      console.log("[WeChat] Bot starting, waiting for scan...");
    })
    .catch((e: Error) => {
      if (bot !== activeBot) return;
      console.error("[WeChat] Bot start failed:", e);
      botStatus = "error";
      setBotError("wechat_bot_start_failed", "微信机器人启动失败。", normalizeErrorMessage(e));
      void stopCurrentBot("error");
    });
}

export async function stopWeChatBot() {
  clearBotError();
  await stopCurrentBot("stopped");
}
