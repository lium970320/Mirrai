import { splitAssistantReplyForChat } from "../_core/reply-utils";

type SocialContactLike = {
  say(text: string): Promise<void> | void;
};

type SendReplyOptions = {
  shouldAbort?: () => boolean;
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

export async function saySocialReply(
  contact: SocialContactLike,
  text: string,
  options: SendReplyOptions = {},
): Promise<number> {
  const chunks = splitAssistantReplyForChat(text);
  let sent = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    if (options.shouldAbort?.()) break;
    if (index > 0) {
      await wait(nextMessageDelayMs(chunks[index], index));
      if (options.shouldAbort?.()) break;
    }
    await contact.say(chunks[index]);
    sent += 1;
  }
  return sent;
}
