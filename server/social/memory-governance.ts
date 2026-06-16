import type { Memory } from "../../drizzle/schema";
import type { StructuredMemoryCard } from "./memory-card";

export type MemoryGovernanceDecision = {
  action: "create" | "skip_duplicate";
  duplicateOf?: number;
  archiveIds: number[];
  contradictIds: number[];
  reasons: string[];
};

type ExistingMemory = Pick<Memory,
  "id" | "title" | "description" | "memoryType" | "keywords" | "importance" | "confidence" | "status"
>;

const STOP_WORDS = new Set([
  "这个", "那个", "什么", "怎么", "为什么", "是不是", "没有", "就是", "然后",
  "还是", "可以", "现在", "一下", "一个", "一些", "我们", "你们", "他们",
  "今天", "昨天", "之前", "以前", "刚才", "真的", "感觉", "时候", "用户",
]);

const CONCRETE_LOCATION_TERMS = ["武汉", "南京", "北京", "上海", "广州", "深圳", "杭州"];
const LOCATION_TERMS = [...CONCRETE_LOCATION_TERMS, "家里", "学校", "研究所", "大学", "宿舍"];

function compactText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function keywordArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
}

function termsFromText(text: string): string[] {
  const chineseTerms = Array.from(text.matchAll(/[\u4e00-\u9fa5]{2,8}/g))
    .map(match => match[0])
    .filter(term => !STOP_WORDS.has(term));
  const latinTerms = Array.from(text.matchAll(/[a-zA-Z0-9_]{3,}/g)).map(match => match[0].toLowerCase());
  return Array.from(new Set([...chineseTerms, ...latinTerms])).slice(0, 32);
}

function memoryTerms(memory: ExistingMemory | StructuredMemoryCard): Set<string> {
  const keywords = "keywords" in memory ? keywordArray(memory.keywords) : [];
  const text = [
    compactText(memory.title),
    compactText(memory.description),
    keywords.join("\n"),
  ].join("\n");
  return new Set([...termsFromText(text), ...keywords]);
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  let score = 0;
  for (const term of Array.from(a)) {
    if (b.has(term)) score += Math.min(6, term.length);
  }
  return score;
}

function hasNegation(text: string): boolean {
  return /不是|不再|已经不|没有|别再|不要|不喜欢|讨厌|不想|不能/.test(text);
}

function isNegatedLocationMention(text: string, term: string): boolean {
  const compact = text.replace(/\s+/g, "");
  let fromIndex = 0;
  while (fromIndex < compact.length) {
    const index = compact.indexOf(term, fromIndex);
    if (index < 0) return false;
    const prefix = compact.slice(Math.max(0, index - 8), index);
    if (!/(不在|不再在|已经不在|没在|没有在|不是在|离开|搬离)$/.test(prefix)) {
      return false;
    }
    fromIndex = index + term.length;
  }
  return true;
}

function locationsIn(text: string): Set<string> {
  return new Set(LOCATION_TERMS.filter(term => text.includes(term) && !isNegatedLocationMention(text, term)));
}

function comparableLocations(locations: Set<string>): Set<string> {
  const concrete = CONCRETE_LOCATION_TERMS.filter(term => locations.has(term));
  return concrete.length ? new Set(concrete) : locations;
}

function hasLocationConflict(card: StructuredMemoryCard, memory: ExistingMemory): boolean {
  const cardLocations = comparableLocations(locationsIn(`${card.title}\n${card.description}\n${card.keywords.join("\n")}`));
  const memoryLocations = comparableLocations(locationsIn(`${memory.title}\n${memory.description || ""}\n${keywordArray(memory.keywords).join("\n")}`));
  if (cardLocations.size === 0 || memoryLocations.size === 0) return false;
  for (const cardLocation of Array.from(cardLocations)) {
    for (const memoryLocation of Array.from(memoryLocations)) {
      if (cardLocation !== memoryLocation) return true;
    }
  }
  return false;
}

function hasDirectConflict(card: StructuredMemoryCard, memory: ExistingMemory): boolean {
  const cardText = `${card.title}\n${card.description}`;
  const memoryText = `${memory.title}\n${memory.description || ""}`;
  if (hasNegation(cardText) !== hasNegation(memoryText)) return true;
  return hasLocationConflict(card, memory);
}

function isDuplicate(card: StructuredMemoryCard, memory: ExistingMemory, overlap: number): boolean {
  if ((memory.status || "active") !== "active") return false;
  if (card.memoryType !== memory.memoryType) return false;
  if (compactText(card.title) === compactText(memory.title)) return true;
  if (overlap >= 10 && !hasDirectConflict(card, memory)) return true;
  return false;
}

export function decideMemoryGovernance(
  card: StructuredMemoryCard,
  existingMemories: ExistingMemory[],
): MemoryGovernanceDecision {
  const cardTerms = memoryTerms(card);
  const archiveIds = new Set<number>();
  const contradictIds = new Set<number>();
  const reasons: string[] = [];

  for (const memory of existingMemories) {
    if ((memory.status || "active") !== "active") continue;
    const overlap = overlapScore(cardTerms, memoryTerms(memory));

    if (isDuplicate(card, memory, overlap)) {
      return {
        action: "skip_duplicate",
        duplicateOf: memory.id,
        archiveIds: [],
        contradictIds: [],
        reasons: [`与现有记忆 #${memory.id} 高度重复，跳过写入。`],
      };
    }

    // 否定极性差异是弱证据：必须有足够强的主题重叠（overlap>=6，约等于命中多个词或一个长实义词）
    // 才认定冲突。否则两条主题不同、仅共享一个高频词（如都含某个人名）的记忆会被误判为
    // contradicted，悄悄损坏记忆账本。可靠的地点/状态冲突由下面的独立分支按更低阈值单独处理。
    if (overlap >= 6 && card.memoryType === memory.memoryType && hasDirectConflict(card, memory)) {
      const cardConfidence = card.confidence ?? 3;
      const oldConfidence = memory.confidence ?? 3;
      if (cardConfidence >= oldConfidence && card.importance >= 4) {
        contradictIds.add(memory.id);
        reasons.push(`新记忆与 #${memory.id} 存在冲突，旧记忆标记为 contradicted。`);
      } else {
        reasons.push(`新记忆与 #${memory.id} 可能冲突，但可信度不足，保留旧记忆。`);
      }
    }

    if (
      overlap > 0
      && card.memoryType === memory.memoryType
      && hasLocationConflict(card, memory)
      && card.confidence >= (memory.confidence ?? 3)
      && card.importance >= 4
    ) {
      contradictIds.add(memory.id);
      reasons.push(`新记忆与 #${memory.id} 的地点/状态事实冲突，旧记忆标记为 contradicted。`);
    }

    if (memory.memoryType === "open_loop" && card.memoryType !== "open_loop" && overlap >= 2) {
      archiveIds.add(memory.id);
      reasons.push(`新记忆可能关闭了未完成话题 #${memory.id}，旧 open_loop 归档。`);
    }
  }

  return {
    action: "create",
    archiveIds: Array.from(archiveIds),
    contradictIds: Array.from(contradictIds),
    reasons,
  };
}
