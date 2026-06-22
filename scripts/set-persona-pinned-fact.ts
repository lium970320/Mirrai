import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb, getPinnedMemoryFacts } from "../server/db";

/**
 * 一次性脚本：把「用户已结课、目前没有课」固定为「已确认事实」(pinnedFact)，
 * 让人物别再问课多不多、别再深夜以"明天还有早课"为由催睡。
 * pinnedFact 命中条件：status=active、memoryType∈{user_fact,promise,preference}、importance≥4。
 * 幂等：同标题已存在则更新，否则插入。在运行副本里跑：
 *   npx tsx scripts/set-persona-pinned-fact.ts
 */

const PERSONA_ID = Number(process.env.PINNED_PERSONA_ID ?? "1");
const TITLE = "用户已结课、目前没有课";
const DESCRIPTION =
  "用户已经结课，现在没有课程安排，也没有早课或晚课。关心他时不要再问课多不多、上课累不累，"
  + "更不要在深夜以「明天还有课」「明天还有早课」为由催他睡觉。";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  // 1. 找 persona 的 owner userId
  const personaRes = await db.execute(sql`SELECT "userId" FROM personas WHERE id = ${PERSONA_ID} LIMIT 1`);
  const personaRows = ((personaRes as unknown as { rows?: any[] }).rows ?? (personaRes as any)) as any[];
  const userId = personaRows?.[0]?.userId;
  if (userId == null) throw new Error(`找不到 persona ${PERSONA_ID} 的 userId`);

  // 2. 幂等：同标题 active 记忆则更新，否则插入
  const upd = await db.execute(sql`
    UPDATE memories
    SET "description" = ${DESCRIPTION}, "memoryType" = 'user_fact',
        "importance" = 5, "confidence" = 5, "status" = 'active'
    WHERE "personaId" = ${PERSONA_ID} AND "userId" = ${userId} AND "title" = ${TITLE}
    RETURNING id
  `);
  const updRows = ((upd as unknown as { rows?: any[] }).rows ?? (upd as any)) as any[];
  if (updRows?.length) {
    console.log(`已更新现有记忆 id=${JSON.stringify(updRows)}`);
  } else {
    const ins = await db.execute(sql`
      INSERT INTO memories ("personaId","userId","title","description","memoryType","importance","confidence","source","status","category")
      VALUES (${PERSONA_ID}, ${userId}, ${TITLE}, ${DESCRIPTION}, 'user_fact', 5, 5, 'manual', 'active', 'memory')
      RETURNING id
    `);
    const insRows = ((ins as unknown as { rows?: any[] }).rows ?? (ins as any)) as any[];
    console.log(`已插入新记忆 id=${JSON.stringify(insRows)}`);
  }

  // 3. 校验：读回 pinnedFacts，确认这条已进入「已确认事实」
  const facts = await getPinnedMemoryFacts(PERSONA_ID, userId);
  console.log(`persona=${PERSONA_ID} userId=${userId} 当前 pinnedFacts（${facts.length} 条）：`);
  facts.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
