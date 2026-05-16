export type StickerIntent = {
  shouldSend: boolean;
  mood?: string;
  intensity?: number;
  tags?: string[];
  reason?: string;
};

export type StickerIntentInput = {
  inputText: string;
  replyText: string;
  userSentSticker?: boolean;
};

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

function textLength(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

export function looksSeriousOrTechnicalForSticker(text: string): boolean {
  return includesAny(text, [
    /代码|bug|报错|数据库|接口|部署|配置|脚本|服务|端口|日志|模型参数|token|api|github/i,
    /论文|作业|批改|公式|证明|分析|解释一下|怎么实现|步骤|方案|文档/,
    /封控|登录失败|连接失败|打不开|进不去|崩了|错误|异常/,
  ]);
}

export function detectStickerIntent(input: StickerIntentInput): StickerIntent {
  const combined = `${input.inputText}\n${input.replyText}`;
  const replyLength = textLength(input.replyText);

  if (!input.userSentSticker && replyLength > 90) {
    return { shouldSend: false, reason: "reply_too_long" };
  }
  if (looksSeriousOrTechnicalForSticker(combined)) {
    return { shouldSend: false, reason: "serious_or_technical" };
  }

  if (input.userSentSticker) {
    return {
      shouldSend: true,
      mood: "认同",
      intensity: 2,
      tags: ["reaction", "daily"],
      reason: "user_sent_sticker",
    };
  }

  if (includesAny(combined, [/哈哈|笑死|别闹|逗我|调侃|欠揍|坏|贫|嘴硬|哼|你还挺|有点意思/])) {
    return {
      shouldSend: true,
      mood: "吐槽",
      intensity: 3,
      tags: ["tease", "funny", "reaction"],
      reason: "tease_or_joke",
    };
  }

  if (includesAny(combined, [/想你|抱抱|亲近|陪我|撒娇|哄我|乖|黏|舍不得/])) {
    return {
      shouldSend: true,
      mood: "撒娇",
      intensity: 3,
      tags: ["close", "soft"],
      reason: "close_or_clingy",
    };
  }

  if (includesAny(combined, [/害羞|脸红|夸我|夸你|不好意思|被你说得/])) {
    return {
      shouldSend: true,
      mood: "害羞",
      intensity: 2,
      tags: ["soft", "positive"],
      reason: "shy",
    };
  }

  if (includesAny(combined, [/累|难受|委屈|想哭|不开心|心疼|别怕|陪着你|慢慢来|没事/])) {
    return {
      shouldSend: true,
      mood: "安慰",
      intensity: 2,
      tags: ["comfort", "soft"],
      reason: "comfort",
    };
  }

  if (includesAny(combined, [/生气|气你|不许|再这样|欠收拾|瞪你|烦你/])) {
    return {
      shouldSend: true,
      mood: "生气",
      intensity: 2,
      tags: ["reaction", "tease"],
      reason: "mild_angry",
    };
  }

  if (includesAny(combined, [/嗯|好|行|知道了|可以|对|是这样|听你的/]) && replyLength <= 28) {
    return {
      shouldSend: true,
      mood: "认同",
      intensity: 1,
      tags: ["daily", "positive"],
      reason: "short_ack",
    };
  }

  if (includesAny(combined, [/开心|高兴|不错|挺好|好呀|可以啊/]) && replyLength <= 60) {
    return {
      shouldSend: true,
      mood: "开心",
      intensity: 2,
      tags: ["positive", "daily"],
      reason: "positive_daily",
    };
  }

  if (includesAny(combined, [/啊？|什么|没懂|怎么了|咋了|为什么/]) && replyLength <= 60) {
    return {
      shouldSend: true,
      mood: "困惑",
      intensity: 2,
      tags: ["reaction", "daily"],
      reason: "confused",
    };
  }

  return { shouldSend: false, reason: "no_sticker_intent" };
}
