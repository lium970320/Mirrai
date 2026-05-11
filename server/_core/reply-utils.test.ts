import { describe, expect, it } from "vitest";
import { cleanAssistantReply, splitAssistantReplyForChat, stripLeadingAsides } from "./reply-utils";

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
