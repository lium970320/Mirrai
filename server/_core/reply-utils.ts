const LEADING_ASIDE_PATTERN =
  /^\s*(?:[（(【\[][^）)\]】]{1,80}[）)\]】]\s*)+/;
const LEADING_SPEAKER_LABEL_PATTERN =
  /^\s*(王芃泽|王鹏泽|叔|柱子|敏子|敏|Minzi|AI|助手|角色|机器人)\s*[：:]\s*/i;
const SENTENCE_PATTERN = /[^。！？!?…；;\n]+[。！？!?…；;]*/g;
const CLAUSE_PATTERN = /[^，,、\n]+[，,、]*/g;

const DEFAULT_WECHAT_SOFT_LIMIT = 78;
const DEFAULT_WECHAT_HARD_LIMIT = 118;
const DEFAULT_WECHAT_MAX_MESSAGES = 3;
const DEFAULT_WECHAT_MAX_SENTENCES = 3;

type ChatSplitOptions = {
  softLimit?: number;
  hardLimit?: number;
  maxMessages?: number;
  maxSentencesPerMessage?: number;
};

export function stripLeadingAsides(text: string): string {
  let result = text.trimStart();

  for (let i = 0; i < 4; i++) {
    const next = result.replace(LEADING_ASIDE_PATTERN, "").trimStart();
    if (next === result) break;
    result = next;
  }

  return result.trim() || text.trim();
}

function stripLeadingSpeakerLabel(text: string): string {
  let result = text.trimStart();
  for (let i = 0; i < 3; i++) {
    const match = result.match(LEADING_SPEAKER_LABEL_PATTERN);
    if (!match) break;
    const name = match[1];
    const rest = result.slice(match[0].length).trimStart();
    if (!rest) return "";
    result = /^(敏子|敏|Minzi)$/i.test(name) ? `${name}，${rest}` : rest;
  }
  return result.trim();
}

export function cleanAssistantReply(
  text: string | null | undefined,
  fallback = "我在。",
): string {
  const raw = (text ?? "").trim();
  if (!raw) return fallback;

  const stripped = stripLeadingSpeakerLabel(stripLeadingAsides(raw)).trim();
  const strippedAgain = stripLeadingSpeakerLabel(raw.replace(LEADING_ASIDE_PATTERN, "").trim()).trim();

  return strippedAgain ? stripped : fallback;
}

function normalizeReplyText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function joinMessageSegments(current: string, next: string): string {
  if (!current) return next;
  if (/[A-Za-z0-9]$/.test(current) && /^[A-Za-z0-9]/.test(next)) {
    return `${current} ${next}`;
  }
  return `${current}${next}`;
}

function splitByLength(text: string, limit: number): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += limit) {
    const chunk = chars.slice(i, i + limit).join("").trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function packSegments(segments: string[], softLimit: number, hardLimit: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) continue;

    if (segment.length > hardLimit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitByLength(segment, hardLimit));
      continue;
    }

    const next = joinMessageSegments(current, segment);
    if (current && next.length > softLimit) {
      chunks.push(current);
      current = segment;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitSentenceForChat(sentence: string, softLimit: number, hardLimit: number): string[] {
  if (sentence.length <= hardLimit) return [sentence];

  const clauses = sentence.match(CLAUSE_PATTERN)?.map(s => s.trim()).filter(Boolean) ?? [];
  if (clauses.length > 1) {
    return packSegments(clauses, softLimit, hardLimit).flatMap(chunk =>
      chunk.length > hardLimit ? splitByLength(chunk, hardLimit) : [chunk],
    );
  }

  return splitByLength(sentence, hardLimit);
}

function packSentencesForChat(
  sentences: string[],
  softLimit: number,
  hardLimit: number,
  maxSentencesPerMessage: number,
): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentSentenceCount = 0;

  const flush = () => {
    if (!current) return;
    chunks.push(current);
    current = "";
    currentSentenceCount = 0;
  };

  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;

    const sentenceParts = splitSentenceForChat(sentence, softLimit, hardLimit);
    for (const part of sentenceParts) {
      const next = joinMessageSegments(current, part);
      const nextSentenceCount = currentSentenceCount + 1;
      const shouldMerge =
        current &&
        next.length <= softLimit &&
        nextSentenceCount <= maxSentencesPerMessage;

      if (!current) {
        current = part;
        currentSentenceCount = 1;
      } else if (shouldMerge) {
        current = next;
        currentSentenceCount = nextSentenceCount;
      } else {
        flush();
        current = part;
        currentSentenceCount = 1;
      }
    }
  }

  flush();
  return chunks;
}

function compactTextLength(text: string): number {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function shouldSplitCompactParagraph(paragraph: string, sentences: string[], softLimit: number): boolean {
  if (sentences.length <= 1) return false;

  const length = compactTextLength(paragraph);
  if (sentences.length >= 4) return true;
  if (sentences.length >= 3 && length >= 38) return true;
  if (sentences.length >= 2 && length >= Math.min(softLimit, 40)) return true;
  return false;
}

function splitParagraphForChat(
  paragraph: string,
  softLimit: number,
  hardLimit: number,
  maxSentencesPerMessage: number,
): string[] {
  const sentences = paragraph.match(SENTENCE_PATTERN)?.map(s => s.trim()).filter(Boolean) ?? [];
  if (paragraph.length <= hardLimit) {
    if (!shouldSplitCompactParagraph(paragraph, sentences, softLimit)) return [paragraph];

    return packSentencesForChat(
      sentences,
      Math.min(softLimit, 62),
      hardLimit,
      1,
    );
  }

  if (sentences.length > 1) {
    return packSentencesForChat(sentences, softLimit, hardLimit, maxSentencesPerMessage);
  }

  return splitSentenceForChat(paragraph, softLimit, hardLimit);
}

function capChatMessages(chunks: string[], maxMessages: number): string[] {
  const cleanChunks = chunks.map(chunk => chunk.trim()).filter(Boolean);
  if (cleanChunks.length <= maxMessages) return cleanChunks;

  return [
    ...cleanChunks.slice(0, maxMessages - 1),
    cleanChunks.slice(maxMessages - 1).join("\n").trim(),
  ].filter(Boolean);
}

export function splitAssistantReplyForChat(
  text: string | null | undefined,
  options: ChatSplitOptions = {},
): string[] {
  const raw = normalizeReplyText(text ?? "");
  if (!raw) return [];

  const softLimit = options.softLimit ?? DEFAULT_WECHAT_SOFT_LIMIT;
  const hardLimit = options.hardLimit ?? DEFAULT_WECHAT_HARD_LIMIT;
  const maxMessages = options.maxMessages ?? DEFAULT_WECHAT_MAX_MESSAGES;
  const maxSentencesPerMessage = options.maxSentencesPerMessage ?? DEFAULT_WECHAT_MAX_SENTENCES;
  const hasExplicitBreaks = /\n\s*\n/.test(raw);
  const singleParagraphText = raw.replace(/\n+/g, " ").trim();

  if (!hasExplicitBreaks && singleParagraphText.length <= hardLimit) {
    return splitParagraphForChat(
      singleParagraphText,
      softLimit,
      hardLimit,
      maxSentencesPerMessage,
    );
  }

  const paragraphs = raw
    .split(/\n{2,}/)
    .map(part => part.replace(/\n+/g, " ").trim())
    .filter(Boolean);

  const chunks = paragraphs.flatMap(paragraph =>
    splitParagraphForChat(paragraph, softLimit, hardLimit, maxSentencesPerMessage),
  );

  return capChatMessages(chunks, maxMessages);
}
