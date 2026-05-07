import { WechatyBuilder, ScanStatus } from "wechaty";
import type { WechatyInterface } from "wechaty/impls";
import fs from "fs";
import path from "path";
import { ENV } from "../_core/env";
import { handleWeChatMessage } from "./message-handler";

let bot: WechatyInterface | null = null;
let currentQrUrl: string | null = null;
let botStatus: "stopped" | "starting" | "scanning" | "logged_in" | "error" = "stopped";
let loggedInUser: string | null = null;

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
    hasStoredSession: fs.existsSync(memoryFilePath),
  };
}

export function getBotStatus() {
  return {
    status: botStatus,
    qrCodeUrl: currentQrUrl,
    loggedInUser,
    hasStoredSession: fs.existsSync(getMemoryFilePath()),
  };
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
    await contact.say(text);
    botStatus = "logged_in";
    console.log(`[WeChat] Sent proactive message to ${contactName || contactId}`);
    return true;
  } catch (error) {
    console.error(`[WeChat] Failed to send proactive message to ${contactName || contactId}:`, error);
    return false;
  }
}

export function startWeChatBot() {
  if (bot) return;

  const CHROME_BIN = process.env.CHROME_BIN ? { endpoint: process.env.CHROME_BIN } : {};
  const { memoryName, hasStoredSession } = prepareMemoryCard();
  botStatus = "starting";
  currentQrUrl = null;

  bot = WechatyBuilder.build({
    name: memoryName,
    puppet: ENV.wechatPuppet as any,
    puppetOptions: { uos: true, ...CHROME_BIN },
  });

  console.log(hasStoredSession
    ? "[WeChat] Stored login session found; attempting automatic login"
    : "[WeChat] No stored login session; scan is required");

  bot.on("scan", (qrcode: string, status: number) => {
    if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
      currentQrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrcode)}`;
      botStatus = "scanning";
      console.log("[WeChat] Scan QR:", currentQrUrl);
    }
  });

  bot.on("login", (user: any) => {
    loggedInUser = user.name();
    botStatus = "logged_in";
    currentQrUrl = null;
    console.log(`[WeChat] ${loggedInUser} logged in`);
  });

  bot.on("logout", (user: any) => {
    loggedInUser = null;
    botStatus = "stopped";
    currentQrUrl = null;
    console.log(`[WeChat] ${user.name()} logged out`);
  });

  bot.on("message", async (msg: any) => {
    try {
      if (loggedInUser && botStatus === "error") {
        botStatus = "logged_in";
      }
      await handleWeChatMessage(msg, bot!);
    } catch (e) {
      console.error("[WeChat] Message handler error:", e);
    }
  });

  bot.on("error", (e: Error) => {
    console.error("[WeChat] Bot error:", e);
    if (!loggedInUser) {
      botStatus = "error";
    }
  });

  bot.start()
    .then(() => console.log("[WeChat] Bot starting, waiting for scan..."))
    .catch((e: Error) => {
      console.error("[WeChat] Bot start failed:", e);
      botStatus = "error";
    });
}

export async function stopWeChatBot() {
  if (!bot) return;
  try {
    await bot.stop();
  } catch (e) {
    console.error("[WeChat] Bot stop error:", e);
  }
  bot = null;
  botStatus = "stopped";
  currentQrUrl = null;
  loggedInUser = null;
}
