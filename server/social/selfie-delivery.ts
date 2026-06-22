// 照片成功发出后的「交付信号」：图已经送到对方手机，人物紧跟着补一句让对方看，
// 和之前的「预告」（"等下给你拍"）形成闭环。短句场景用话术池随机选 + 避免与上一句连续重复，
// 零延迟、不调 LLM；按自拍 / 环境分两组。独立文件，避免与「LLM 通用拍照」改动撞车。

export type PhotoDeliveryKind = "selfie" | "environment";

const DELIVERY_LINES: Record<PhotoDeliveryKind, string[]> = {
  selfie: [
    "喏，拍好了。",
    "拍好了，给你看。",
    "喏，刚拍的。",
    "给你瞧瞧，我现在就这样。",
    "拍好了，看吧。",
    "诶，看看这张。",
  ],
  environment: [
    "喏，拍好了，看看我这儿。",
    "这就是我现在待的地方。",
    "拍好了，我这边就这样。",
    "给你瞧瞧，家里就这模样。",
    "喏，这是我眼前的样子。",
    "看吧，就这样。",
  ],
};

// 按 contactId+kind 记上次用的下标，下次尽量错开，避免连着重复同一句。
const lastDeliveryIndex: Record<string, number> = {};

/** 照片成功发出后补的一句交付语；随机选并尽量不与上一句重复。random 可注入便于单测。 */
export function pickSelfieDeliveryLine(
  kind: PhotoDeliveryKind,
  contactId: string,
  random: () => number = Math.random,
): string {
  const lines = DELIVERY_LINES[kind];
  const key = `${contactId}:${kind}`;
  const last = lastDeliveryIndex[key];
  let idx = Math.floor(random() * lines.length);
  if (idx < 0) idx = 0;
  if (idx >= lines.length) idx = lines.length - 1;
  if (lines.length > 1 && idx === last) idx = (idx + 1) % lines.length;
  lastDeliveryIndex[key] = idx;
  return lines[idx];
}
