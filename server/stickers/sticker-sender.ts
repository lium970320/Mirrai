import fs from "fs";
import path from "path";
import { recordOperationsEvent } from "../_core/operations-events";
import { sendQqImageFile } from "../qq/onebot-client";
import type { SelectedSticker } from "./sticker-selector";

export type StickerSendResult =
  | { ok: true; sentAs: "onebot_image" | "onebot_gif" }
  | { ok: false; status: "sticker_send_failed"; reason: string };

export async function sendQqSticker(contactId: string, sticker: SelectedSticker): Promise<StickerSendResult> {
  console.info(`sticker_send_start platform=qq contact=${contactId} id=${sticker.id}`);
  try {
    if (!fs.existsSync(sticker.path)) {
      recordOperationsEvent({
        id: "stickers.file_not_found",
        scope: "stickers",
        title: "表情包文件不存在",
        detail: "表情包策略已选中素材，但本地文件不存在；主文字回复会保留。",
        evidence: sticker.path,
      });
      return { ok: false, status: "sticker_send_failed", reason: "file_not_found" };
    }
    const stat = fs.statSync(sticker.path);
    if (!stat.isFile() || stat.size <= 0) {
      recordOperationsEvent({
        id: "stickers.invalid_file",
        scope: "stickers",
        title: "表情包文件无效",
        detail: "表情包素材不是有效文件或文件为空；主文字回复会保留。",
        evidence: sticker.path,
      });
      return { ok: false, status: "sticker_send_failed", reason: "invalid_file" };
    }
    const extension = path.extname(sticker.path).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension)) {
      recordOperationsEvent({
        id: "stickers.unsupported_file_type",
        scope: "stickers",
        title: "表情包文件类型不支持",
        detail: "OneBot 表情包发送只支持常见图片格式；主文字回复会保留。",
        evidence: `${sticker.path} extension=${extension || "none"}`,
      });
      return { ok: false, status: "sticker_send_failed", reason: "unsupported_file_type" };
    }

    const sent = await sendQqImageFile(contactId, sticker.path);
    if (!sent) {
      recordOperationsEvent({
        id: "stickers.onebot_send_failed",
        scope: "stickers",
        title: "OneBot 表情包发送失败",
        detail: "表情包文件有效，但 OneBot image 消息发送失败；主文字回复会保留。",
        evidence: `contact=${contactId}`,
      });
      return { ok: false, status: "sticker_send_failed", reason: "onebot_send_failed" };
    }

    console.info(`sticker_send_success platform=qq contact=${contactId} id=${sticker.id}`);
    return { ok: true, sentAs: sticker.type === "gif" ? "onebot_gif" : "onebot_image" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`sticker_send_failed platform=qq contact=${contactId} id=${sticker.id}`, reason);
    recordOperationsEvent({
      id: "stickers.send_exception",
      scope: "stickers",
      title: "表情包发送异常",
      detail: "表情包发送过程中抛出异常；主文字回复会保留。",
      rawError: reason,
      evidence: `contact=${contactId} path=${sticker.path}`,
    });
    return { ok: false, status: "sticker_send_failed", reason };
  }
}
