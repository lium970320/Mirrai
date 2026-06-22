/**
 * 人物「想拍照」的意图标记。LLM 在回复末尾另起一行输出
 * `[[PHOTO|带人=是/否|在家=是/否|画面=…]]`，由本模块解析剥离成 PhotoIntent，
 * 再由 message-handler 异步真实生图（selfie-provider.generatePersonaPhoto）。
 *
 * 设计：把"自然想拍什么"的判断交给 LLM 的语义理解（它懂对话语境），
 * 取代规则版 selfie-decision 的概率/正则触发；明确指令（发自拍/拍家里）仍走规则必发。
 */

export type PhotoIntent = {
  /** 带人=是 → 自拍含自己；否 → 只拍环境/物（做的饭、窗外、路上…） */
  includeFace: boolean;
  /** 在家=是 → 家里（附家图、保持同一处）；否 → 外面/别处 */
  atHome: boolean;
  /** 画面描述（LLM 写的，作为生图正文） */
  scene: string;
};

// 鲁棒匹配：方括号内容忍空格、全/半角竖线与等号、是否或 yes/no；画面取到标记结束（不含 `]`）。
const PHOTO_TAG_RE =
  /\[\[\s*PHOTO\s*[|｜]\s*带人\s*[=＝]\s*(是|否|yes|no)\s*[|｜]\s*在家\s*[=＝]\s*(是|否|yes|no)\s*[|｜]\s*画面\s*[=＝]\s*([^\]]*?)\s*\]\]/i;

function isYes(value: string): boolean {
  return value === "是" || /^yes$/i.test(value);
}

/** 从回复里解析并剥离拍照标记；没有标记则原样返回（intent=null）。 */
export function parsePhotoIntent(reply: string): { intent: PhotoIntent | null; cleanedText: string } {
  const text = reply ?? "";
  const match = text.match(PHOTO_TAG_RE);
  if (!match) return { intent: null, cleanedText: text };
  const intent: PhotoIntent = {
    includeFace: isYes(match[1]),
    atHome: isYes(match[2]),
    scene: (match[3] ?? "").trim(),
  };
  // 剥离标记后收尾（标记通常在末尾另起一空行）。
  const cleanedText = text.replace(PHOTO_TAG_RE, "").trim();
  return { intent, cleanedText };
}

/** 门控的系统提示段：允许人物在自然想拍时输出拍照标记。仅在 buildSystemPrompt 的 allowPhotoIntent 时注入。 */
export function buildPhotoIntentInstruction(): string {
  return [
    "【拍照（可选，仅在你自然想拍给对方看时）】",
    "如果这一刻你真的想拍张照片发给对方（比如对方问你在干嘛、你想分享眼前的画面、或聊到适合配图的事），",
    "就在回复的最后、另起一空行，单独输出一行标记：",
    "[[PHOTO|带人=是或否|在家=是或否|画面=简短描述]]",
    "- 带人：照片里有没有你自己（是=自拍含人；否=只拍环境或东西，如做的饭、窗外、路上）",
    "- 在家：是在家里拍，还是在外面（是=家里；否=外面/别处）",
    "- 画面：一句话说清拍什么（如「窝在沙发上」「做的番茄炒蛋」「下班路上的天」）",
    "只在真的想发时才加这一行；不想发就完全不要写。",
    "【重要·拍照分「预告→实拍」两步，别说反】你输出标记的这一刻，照片还没生成、还没发出去——",
    "所以你这段话只能是「预告」的口吻：像「等我拍给你看」「这就拍一张」「我现在给你拍」，让对方知道你正要去拍。",
    "千万不要写得好像照片已经发出去了：别说「给你看这张」「你看我这张」「照片里我正在…」这种已送达或描述画面的话——",
    "等图真发出去之后，系统会自动替你补上「拍好了，看吧」那一句。你只管自然地预告，不要用文字描述或虚构照片的样子。",
  ].join("\n");
}
