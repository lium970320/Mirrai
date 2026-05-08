import { splitAssistantReplyForChat } from "../_core/reply-utils";

type WeChatContactLike = {
  say(text: string): Promise<void> | void;
};

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nextMessageDelayMs(nextChunk: string, index: number): number {
  const charCount = Array.from(nextChunk.replace(/\s+/g, "")).length;
  const typingDelay = 850 + charCount * 115;
  const indexedPause = Math.min(index * 260, 900);
  const jitter = Math.floor(Math.random() * 750);
  return Math.min(12_000, Math.max(1_200, typingDelay + indexedPause + jitter));
}

export async function sayWeChatReply(contact: WeChatContactLike, text: string): Promise<number> {
  const chunks = splitAssistantReplyForChat(text);
  for (let index = 0; index < chunks.length; index += 1) {
    if (index > 0) {
      await wait(nextMessageDelayMs(chunks[index], index));
    }
    await contact.say(chunks[index]);
  }
  return chunks.length;
}
