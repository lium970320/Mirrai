import fs from "fs";
import path from "path";
import { sendQqImageFile } from "../qq/onebot-client";
import type { SelectedSticker } from "./sticker-selector";

export type StickerSendResult =
  | { ok: true; sentAs: "onebot_image" | "onebot_gif" }
  | { ok: false; status: "sticker_send_failed"; reason: string };

export async function sendQqSticker(contactId: string, sticker: SelectedSticker): Promise<StickerSendResult> {
  console.info(`sticker_send_start platform=qq contact=${contactId} id=${sticker.id}`);
  try {
    if (!fs.existsSync(sticker.path)) {
      return { ok: false, status: "sticker_send_failed", reason: "file_not_found" };
    }
    const stat = fs.statSync(sticker.path);
    if (!stat.isFile() || stat.size <= 0) {
      return { ok: false, status: "sticker_send_failed", reason: "invalid_file" };
    }
    const extension = path.extname(sticker.path).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension)) {
      return { ok: false, status: "sticker_send_failed", reason: "unsupported_file_type" };
    }

    const sent = await sendQqImageFile(contactId, sticker.path);
    if (!sent) {
      return { ok: false, status: "sticker_send_failed", reason: "onebot_send_failed" };
    }

    console.info(`sticker_send_success platform=qq contact=${contactId} id=${sticker.id}`);
    return { ok: true, sentAs: sticker.type === "gif" ? "onebot_gif" : "onebot_image" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`sticker_send_failed platform=qq contact=${contactId} id=${sticker.id}`, reason);
    return { ok: false, status: "sticker_send_failed", reason };
  }
}
