import { getReadyPersonasForProactiveMessages } from "../db";
import { resolveProactivePreferredTarget } from "./proactive-delivery";
import { getQqBotStatus, sendQqImageFile, sendQqText } from "../qq/onebot-client";
import { generatePersonaPhoto } from "../image/selfie-provider";
import { getPersonaScheduleState } from "../_core/life-schedule";
import { getBeijingDateKey, getBeijingMinuteOfDay } from "../_core/time-context";

/**
 * 固定时间点主动拍照（北京时间）：饭点拍饭、早通勤自拍、傍晚回家拍风景。
 * 到点直接生成对应内容的照片并发到 QQ——不靠用户开口、不走 LLM [[PHOTO]] 标记、不受拍照冷却限制
 * （这是「人物自己一天里的固定动作」，与对话触发的拍照是两条线）。未开启拍照(PERSONA_SELFIE_ENABLED)时
 * generatePersonaPhoto 返回 null，自动跳过。
 */
type PhotoSlot = {
  id: string;
  time: string; // "HH:MM" 北京时间
  prompt: string; // 生图画面描述
  includeFace: boolean; // 是否自拍含人
  caption: string; // 图发出后补的一句话
};

const PHOTO_SCHEDULE: PhotoSlot[] = [
  { id: "breakfast", time: "07:10", prompt: "刚做好、还冒着热气的早饭，俯拍餐桌一角", includeFace: false, caption: "早，吃了没。" },
  { id: "commute_am", time: "08:10", prompt: "上班通勤路上随手来一张自拍，街道或地铁背景", includeFace: true, caption: "上班路上。" },
  { id: "lunch", time: "12:10", prompt: "中午这顿饭，俯拍餐盘", includeFace: false, caption: "中午吃这个。" },
  { id: "evening_scene", time: "17:40", prompt: "下班回家路上的天色和街景，傍晚的光线", includeFace: false, caption: "下班了，路上天不错。" },
  { id: "dinner", time: "18:40", prompt: "今晚的晚饭，俯拍餐桌", includeFace: false, caption: "晚饭好了。" },
];

const CATCH_UP_MINUTES = 15;
// 当天已发记录（进程内存；重启会清，catch-up 窗口内重启可能当天补发一次，可接受）。
const sentToday = new Map<string, string>();

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

let scheduler: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runScheduledPhotoTick(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const nowMin = getBeijingMinuteOfDay(now);
    const dateKey = getBeijingDateKey(now);
    const due = PHOTO_SCHEDULE.filter(slot => {
      const age = nowMin - minutesOf(slot.time);
      return age >= 0 && age <= CATCH_UP_MINUTES;
    });
    if (due.length === 0) return;
    // 睡眠时段不拍（如周末早上还在睡时，跳过早饭点）。
    if (getPersonaScheduleState(now).category === "sleep") return;

    const personas = await getReadyPersonasForProactiveMessages();
    for (const persona of personas) {
      const target = await resolveProactivePreferredTarget(persona);
      if (target.platform !== "qq" || target.qqBindings.length === 0) continue;

      for (const slot of due) {
        const key = `${persona.id}:${slot.id}`;
        if (sentToday.get(key) === dateKey) continue;
        sentToday.set(key, dateKey); // 先占位，避免重入/重试时重发
        const status = await getQqBotStatus();
        if (status.status !== "connected") { sentToday.delete(key); continue; }
        const result = await generatePersonaPhoto({ prompt: slot.prompt, includeFace: slot.includeFace, atHome: false });
        if (!result) continue; // 未开启 / 生成失败：跳过（已占位，当天不再试）
        for (const binding of target.qqBindings) {
          const ok = await sendQqImageFile(binding.wechatContactId, result.imagePath);
          if (ok) await sendQqText(binding.wechatContactId, slot.caption);
        }
        console.log(`[ScheduledPhoto] sent ${slot.id} persona=${persona.id} at ${slot.time}`);
      }
    }
  } catch (err) {
    console.error("[ScheduledPhoto] tick failed:", err);
  } finally {
    running = false;
  }
}

export function startScheduledPhotos(): void {
  if (scheduler) return;
  scheduler = setInterval(() => void runScheduledPhotoTick(), 60_000);
  void runScheduledPhotoTick();
  console.log("[ScheduledPhoto] Scheduler started");
}

export function stopScheduledPhotos(): void {
  if (scheduler) { clearInterval(scheduler); scheduler = null; }
}
