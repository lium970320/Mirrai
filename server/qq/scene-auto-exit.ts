import {
  autoExitSceneAndDualMode,
  getActiveSceneContactIds,
  getDualMode,
  getLastAutoExitDate,
  getSceneMode,
  getSceneOpenedAt,
  setLastAutoExitDate,
  shouldAutoExitForWork,
} from "./scene-commands";
import * as db from "../db";
import { getPersonaScheduleState } from "../_core/life-schedule";
import { getPersonaLifeConfig } from "../_core/persona-life-config";
import { getBeijingDateKey, getBeijingTimeParts } from "../_core/time-context";
import { sendQqText } from "./onebot-client";

/**
 * 作息守门：工作日到上班点（出门通勤 07:40 起），把过夜没关的「场景 / 双人」自动退回日常，
 * 并以王芃泽的口吻发一句「去上班了」的过渡。挂在主动消息调度的每分钟 tick 上顺带执行。
 * 设计取舍见 scene-commands.ts 的 shouldAutoExitForWork：周末不触发；只清过夜遗留、不碰白天手动重开；每天每 contact 一次。
 */

// 退出时发的过渡话术（王芃泽：南京研究所、异地、克制）。按当前分钟轮选，避免每次都一样。
const WORK_EXIT_MESSAGES = [
  "到点了，我得收拾出门去研究所。昨晚那场先到这，白天忙，等下班了再好好陪你。",
  "上班时间到了，我先去所里。白天事多、回得慢，别等我，晚点闲下来找你。",
  "天亮该上班了，咱先从场景里出来。我去研究所，下了班再回来陪你。",
  "得去上班了，先收一收。白天我在所里抽空回，正经的话留到晚上慢慢说。",
];

/** 今天北京 07:40（出门通勤 = 上班点）对应的 epoch 毫秒。 */
export function beijingWorkStartMs(now: Date): number {
  const p = getBeijingTimeParts(now);
  // 北京 07:40 = 该北京日的 UTC 07:40 再减 8 小时（Date.UTC 会把负小时规范到前一天）。
  return Date.UTC(p.year, p.month - 1, p.day, 7 - 8, 40, 0, 0);
}

function pickWorkExitMessage(now: Date): string {
  const idx = getBeijingTimeParts(now).minuteOfDay % WORK_EXIT_MESSAGES.length;
  return WORK_EXIT_MESSAGES[idx];
}

/**
 * 作息守门 tick：遍历当前开着场景/双人的 QQ 会话，工作日到上班点则自动退出 + 发过渡。
 * 任何单个 contact 出错都不影响其它；整体异常由调用方兜住。
 */
export async function runSceneAutoExitTick(now = new Date()): Promise<void> {
  const contactIds = getActiveSceneContactIds();
  if (contactIds.length === 0) return;

  const todayDateKey = getBeijingDateKey(now);
  const workStartMs = beijingWorkStartMs(now);

  for (const contactId of contactIds) {
    try {
      const binding = await db.getQqBindingByContactId(contactId);
      if (!binding) continue;
      const persona = await db.getPersonaById(binding.personaId, binding.userId);
      const lifeConfig = getPersonaLifeConfig((persona as any)?.personaData);
      const state = getPersonaScheduleState(now, lifeConfig);
      const sceneOn = getSceneMode(contactId) || getDualMode(contactId);

      if (!shouldAutoExitForWork({
        dayKind: state.dayKind,
        stateId: state.stateId,
        sceneOn,
        openedAtMs: getSceneOpenedAt(contactId),
        workStartMs,
        lastExitDateKey: getLastAutoExitDate(contactId),
        todayDateKey,
      })) continue;

      await autoExitSceneAndDualMode(contactId, binding.personaId);
      setLastAutoExitDate(contactId, todayDateKey);
      console.info(`[SceneAutoExit] ${contactId} 工作日到上班点(${state.stateId})自动退出场景/双人`);

      try {
        await sendQqText(contactId, pickWorkExitMessage(now));
      } catch (err) {
        console.warn(`[SceneAutoExit] ${contactId} 过渡消息发送失败:`, err);
      }
    } catch (err) {
      console.warn(`[SceneAutoExit] ${contactId} 处理失败:`, err);
    }
  }
}
