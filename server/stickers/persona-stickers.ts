export type PersonaStickerType = "png" | "jpg" | "gif";

export type PersonaSticker = {
  id: string;
  path: string;
  enabled: boolean;
  mood: string[];
  tags: string[];
  intensity: number;
  type: PersonaStickerType;
  description?: string;
};

export const personaStickers: PersonaSticker[] = [
  {
    id: "happy_01",
    path: "happy_01.png",
    enabled: true,
    mood: ["开心", "高兴", "轻松"],
    tags: ["positive", "soft", "daily"],
    intensity: 2,
    type: "png",
    description: "轻松开心的短回应",
  },
  {
    id: "shy_smile_01",
    path: "shy_smile_01.png",
    enabled: true,
    mood: ["害羞", "温柔", "被夸奖"],
    tags: ["soft", "cute", "positive"],
    intensity: 2,
    type: "png",
    description: "轻微害羞地笑",
  },
  {
    id: "clingy_01",
    path: "clingy_01.png",
    enabled: true,
    mood: ["撒娇", "亲近", "想你"],
    tags: ["close", "soft", "daily"],
    intensity: 3,
    type: "png",
    description: "亲近但不过分的撒娇",
  },
  {
    id: "speechless_01",
    path: "speechless_01.png",
    enabled: true,
    mood: ["无语", "尴尬", "吐槽"],
    tags: ["reaction", "funny", "tease"],
    intensity: 3,
    type: "png",
    description: "无语又想吐槽",
  },
  {
    id: "tease_01",
    path: "tease_01.png",
    enabled: true,
    mood: ["吐槽", "调侃", "开玩笑"],
    tags: ["reaction", "funny", "tease"],
    intensity: 3,
    type: "png",
    description: "轻微调侃",
  },
  {
    id: "wronged_01",
    path: "wronged_01.png",
    enabled: true,
    mood: ["委屈", "低落", "被冷落"],
    tags: ["soft", "comfort"],
    intensity: 3,
    type: "png",
    description: "有点委屈",
  },
  {
    id: "comfort_01",
    path: "comfort_01.png",
    enabled: true,
    mood: ["安慰", "心疼", "陪伴"],
    tags: ["comfort", "soft", "close"],
    intensity: 2,
    type: "png",
    description: "温和安慰",
  },
  {
    id: "mild_angry_01",
    path: "mild_angry_01.png",
    enabled: true,
    mood: ["生气", "轻度生气", "不满"],
    tags: ["reaction", "tease"],
    intensity: 2,
    type: "png",
    description: "轻度生气，不攻击",
  },
  {
    id: "agree_01",
    path: "agree_01.png",
    enabled: true,
    mood: ["认同", "点头", "知道了"],
    tags: ["daily", "positive"],
    intensity: 1,
    type: "png",
    description: "认同和简单确认",
  },
  {
    id: "proud_01",
    path: "proud_01.png",
    enabled: true,
    mood: ["得意", "小骄傲", "被夸奖"],
    tags: ["positive", "tease"],
    intensity: 3,
    type: "png",
    description: "有点得意",
  },
  {
    id: "confused_01",
    path: "confused_01.png",
    enabled: true,
    mood: ["困惑", "疑问", "没懂"],
    tags: ["reaction", "daily"],
    intensity: 2,
    type: "png",
    description: "困惑但温和",
  },
];
