import fs from "fs";
import path from "path";
import { ENV } from "../_core/env";
import { personaStickers, type PersonaSticker } from "./persona-stickers";
import type { StickerIntent } from "./sticker-intent";

export type SelectedSticker = {
  id: string;
  path: string;
  type: PersonaSticker["type"];
  mood: string[];
  intensity: number;
};

export type StickerSelectionResult =
  | { ok: true; sticker: SelectedSticker }
  | { ok: false; status: "sticker_not_found"; reason: string };

export type StickerSelectorInput = {
  contactId: string;
  stickerIntent?: StickerIntent;
  stickers?: PersonaSticker[];
  baseDir?: string;
  avoidRepeatRecentCount?: number;
  random?: () => number;
};

const recentStickerIdsByContact = new Map<string, string[]>();

function resolveStickerPath(stickerPath: string, baseDir: string): string {
  if (path.isAbsolute(stickerPath) || /^[a-z]:[\\/]/i.test(stickerPath)) {
    return path.normalize(stickerPath);
  }
  const normalized = stickerPath.replace(/^[\\/]+/, "");
  if (normalized.startsWith("assets/") || normalized.startsWith("assets\\")) {
    return path.resolve(process.cwd(), normalized);
  }
  return path.resolve(baseDir, normalized);
}

function hasAnyOverlap(left: string[], right: string[] = []): boolean {
  const lower = new Set(right.map(item => item.toLowerCase()));
  return left.some(item => lower.has(item.toLowerCase()));
}

function scoreSticker(sticker: PersonaSticker, intent: StickerIntent): number {
  let score = 0;
  if (intent.mood && sticker.mood.some(mood => mood === intent.mood || mood.includes(intent.mood!) || intent.mood!.includes(mood))) {
    score += 10;
  }
  if (intent.tags && hasAnyOverlap(sticker.tags, intent.tags)) {
    score += 4;
  }
  if (typeof intent.intensity === "number") {
    score += Math.max(0, 5 - Math.abs(sticker.intensity - intent.intensity));
  }
  return score;
}

export function selectSticker(input: StickerSelectorInput): StickerSelectionResult {
  const intent = input.stickerIntent;
  console.info(`sticker_intent_detected contact=${input.contactId} should=${intent?.shouldSend === true} mood=${intent?.mood ?? ""}`);
  if (!intent?.shouldSend) {
    return { ok: false, status: "sticker_not_found", reason: "sticker_intent_disabled" };
  }

  const baseDir = input.baseDir ?? ENV.qqStickerBaseDir;
  const stickers = input.stickers ?? personaStickers;
  const recentLimit = Math.max(0, input.avoidRepeatRecentCount ?? ENV.qqStickerReplyAvoidRepeatRecentCount);
  const recent = recentStickerIdsByContact.get(input.contactId) ?? [];
  const enabled = stickers
    .filter(sticker => sticker.enabled)
    .map(sticker => ({
      sticker,
      resolvedPath: resolveStickerPath(sticker.path, baseDir),
      score: scoreSticker(sticker, intent),
    }))
    .filter(candidate => candidate.score > 0)
    .filter(candidate => fs.existsSync(candidate.resolvedPath));

  console.info(`sticker_candidate_found contact=${input.contactId} count=${enabled.length}`);
  if (enabled.length === 0) {
    return { ok: false, status: "sticker_not_found", reason: "no_matching_existing_sticker" };
  }

  const withoutRecent = enabled.filter(candidate => !recent.slice(-recentLimit).includes(candidate.sticker.id));
  const pool = withoutRecent.length ? withoutRecent : enabled;
  const bestScore = Math.max(...pool.map(candidate => candidate.score));
  const best = pool.filter(candidate => candidate.score === bestScore);
  const random = input.random ?? Math.random;
  const chosen = best[Math.floor(random() * best.length)] ?? best[0];

  console.info(`sticker_selected contact=${input.contactId} id=${chosen.sticker.id}`);
  return {
    ok: true,
    sticker: {
      id: chosen.sticker.id,
      path: chosen.resolvedPath,
      type: chosen.sticker.type,
      mood: chosen.sticker.mood,
      intensity: chosen.sticker.intensity,
    },
  };
}

// 仅在表情包真正发送成功后调用，记入「最近使用」去重池。
// 之前在 selectSticker 里选中即记账，发送失败/中止时会污染去重池，在小素材池下尤其明显。
export function markStickerSent(contactId: string, stickerId: string, avoidRepeatRecentCount?: number): void {
  const recentLimit = Math.max(1, avoidRepeatRecentCount ?? ENV.qqStickerReplyAvoidRepeatRecentCount);
  const recent = recentStickerIdsByContact.get(contactId) ?? [];
  recentStickerIdsByContact.set(contactId, [...recent, stickerId].slice(-recentLimit));
}
