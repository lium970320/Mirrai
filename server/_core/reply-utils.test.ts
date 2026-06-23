import { describe, expect, it } from "vitest";
import { cleanAssistantReply, splitAssistantReplyForChat, stripBracketAsides, stripLeadingAsides, stripReplyDecorativeQuotes } from "./reply-utils";

describe("stripLeadingAsides", () => {
  it("removes leading full-width parenthetical narration", () => {
    expect(stripLeadingAsides("（她轻轻笑了一下）今天怎么这么晚呀？")).toBe(
      "今天怎么这么晚呀？"
    );
  });

  it("removes multiple leading asides", () => {
    expect(stripLeadingAsides("（靠近）（压低声音）我在呢。")).toBe("我在呢。");
  });

  it("keeps normal mid-sentence parentheses", () => {
    expect(stripLeadingAsides("我今天有点开心（真的）。")).toBe("我今天有点开心（真的）。");
  });
});

describe("cleanAssistantReply", () => {
  it("uses a plain fallback when the reply is only an aside", () => {
    expect(cleanAssistantReply("（沉默）")).toBe("我在。");
  });

  it("removes leading narration before storing assistant replies", () => {
    expect(cleanAssistantReply("（他低头看了看茶杯）敏子，先吃饭。")).toBe("敏子，先吃饭。");
  });

  it("removes leading speaker labels from assistant replies", () => {
    expect(cleanAssistantReply("王芃泽：我在。")).toBe("我在。");
    expect(cleanAssistantReply("敏子：爱。")).toBe("敏子，爱。");
  });

  it("removes decorative quote wrappers from assistant replies", () => {
    expect(cleanAssistantReply("“王芃泽：敏子，我在。”")).toBe("敏子，我在。");
    expect(cleanAssistantReply("敏子：“爱。”")).toBe("敏子，爱。");
    expect(stripReplyDecorativeQuotes("「我在。」")).toBe("我在。");
  });

  it("keeps meaningful inline quotes", () => {
    expect(stripReplyDecorativeQuotes("我刚说“晚安”")).toBe("我刚说“晚安”");
  });

  it("removes forced directness challenge endings", () => {
    expect(cleanAssistantReply("我爱你，敏子。不是随口说的。够不够直接？不够我明天当面跟你说。")).toBe(
      "我爱你，敏子。不是随口说的。"
    );
  });

  it("removes intensity self-rating tails without dropping the real reply", () => {
    expect(cleanAssistantReply("我想你想得睡不着。早上醒来就想看见你。够浓烈了吗？再浓我怕你受不住。")).toBe(
      "我想你想得睡不着。早上醒来就想看见你。"
    );
  });

  it("removes sarcastic sincerity self-rating tails", () => {
    expect(cleanAssistantReply("我说的是真的，敏子，我没有拿你当玩笑。行了吧，够真了？")).toBe(
      "我说的是真的，敏子，我没有拿你当玩笑。"
    );
    expect(cleanAssistantReply("我会认真等你，也认真把这段关系放在心上。够认真了？")).toBe(
      "我会认真等你，也认真把这段关系放在心上。"
    );
  });

  it("falls back when the reply is only a forced directness challenge", () => {
    expect(cleanAssistantReply("够不够直接？不够我明天当面跟你说。")).toBe("我在。");
  });

  it("removes overused leading catchphrases while keeping the real reply", () => {
    expect(cleanAssistantReply("你听好了，敏子，我不是不想你，是怕你又胡思乱想。")).toBe(
      "敏子，我不是不想你，是怕你又胡思乱想。"
    );
  });

  it("removes mechanical sleep-closure tails while keeping the reply content", () => {
    expect(cleanAssistantReply("我在，你刚才那句话我听见了。行了，别闹了，快睡。")).toBe(
      "我在，你刚才那句话我听见了。"
    );
  });

  it("falls back when the reply is only an overused sleep closure", () => {
    expect(cleanAssistantReply("行了，别闹了，快睡。")).toBe("我在。");
  });
});

describe("splitAssistantReplyForChat", () => {
  it("keeps short replies as one chat message", () => {
    expect(splitAssistantReplyForChat("敏子，到饭点了，先去吃点热的。")).toEqual([
      "敏子，到饭点了，先去吃点热的。",
    ]);
  });

  it("uses line breaks as explicit separate chat messages", () => {
    expect(splitAssistantReplyForChat("敏子，中午了。\n\n武汉今天热不热？吃饭别凑合。")).toEqual([
      "敏子，中午了。",
      "武汉今天热不热？吃饭别凑合。",
    ]);
  });

  it("does not treat accidental single line wrapping as forced split", () => {
    expect(splitAssistantReplyForChat("敏子，中午了。\n武汉今天热不热？")).toEqual([
      "敏子，中午了。 武汉今天热不热？",
    ]);
  });

  it("keeps compact multi-sentence replies together", () => {
    expect(splitAssistantReplyForChat("行了，别委屈了。先喝口水。等你缓一缓再跟我说。")).toEqual([
      "行了，别委屈了。先喝口水。等你缓一缓再跟我说。",
    ]);
  });

  it("splits medium multi-sentence replies even without explicit blank lines", () => {
    expect(splitAssistantReplyForChat("我吃过了，在所里食堂随便打了点菜。你别又拿饼干凑合，武汉今天热，吃点正经饭。下课以后跟我说一声。")).toEqual([
      "我吃过了，在所里食堂随便打了点菜。",
      "你别又拿饼干凑合，武汉今天热，吃点正经饭。",
      "下课以后跟我说一声。",
    ]);
  });

  it("splits two long-enough sentences at a natural boundary", () => {
    expect(splitAssistantReplyForChat("我刚把下午的图件看完，眼睛有点酸。你那边如果还在备课，就先把水喝了，别一直拖到很晚。")).toEqual([
      "我刚把下午的图件看完，眼睛有点酸。",
      "你那边如果还在备课，就先把水喝了，别一直拖到很晚。",
    ]);
  });

  it("splits long paragraph replies into shorter chat messages", () => {
    const chunks = splitAssistantReplyForChat(
      "敏子，我刚从所里出来，忽然想到你今天下午还有课。武汉最近热起来了，你别一直站着讲太久，回办公室以后先喝点水，再慢慢处理学生的事。要是晚上还有材料要看，也别硬撑到太晚，等你空下来再跟我说一声就行。我这边晚点还要把上午的图件核一遍，可能回得慢一点，但不是不理你。",
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThanOrEqual(3);
    expect(chunks.every(chunk => chunk.length <= 118)).toBe(true);
  });
});

describe("非沉浸模式清除【】旁白（修「旁白和说话混在一起」）", () => {
  it("清除句中/句尾的【】旁白，只留对话", () => {
    expect(cleanAssistantReply("你这话冤枉我了。【他撑起身子，低头看你】我哪舍得就睡。")).toBe(
      "你这话冤枉我了。我哪舍得就睡。"
    );
  });

  it("清除多段【】旁白后不残留方括号、对话内容都在", () => {
    const r = cleanAssistantReply("【他迷迷糊糊嗯了一声】\n\n没睡，守你呢。\n\n【他缓缓睁眼】\n\n你看我耳朵都烫了。");
    expect(r).not.toMatch(/[【】]/);
    expect(r).toContain("没睡，守你呢。");
    expect(r).toContain("你看我耳朵都烫了。");
  });

  it("整条都是【】旁白时落到 fallback", () => {
    expect(cleanAssistantReply("【他没说话，只是把你搂得更紧】")).toBe("我在。");
  });

  it("沉浸模式（场景）保留【】旁白不清", () => {
    const r = cleanAssistantReply("【他低头看你】我在呢。", "我在。", { immersiveMode: true });
    expect(r).toContain("【他低头看你】");
    expect(r).toContain("我在呢。");
  });

  it("stripBracketAsides 直接调用：去所有【】、整条旁白返回空串", () => {
    expect(stripBracketAsides("【A】话一。【B】话二。")).toBe("话一。话二。");
    expect(stripBracketAsides("【整条都是旁白】")).toBe("");
  });

  it("不误伤没有【】的普通回复", () => {
    expect(cleanAssistantReply("我在看那本书，挺好的。")).toBe("我在看那本书，挺好的。");
  });
});
