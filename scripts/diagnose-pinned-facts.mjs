// 诊断「人物忘了已确认事实（如已结课）」：一键查 pinned 事实的真实状态并给出 A/B/C 结论。
// 运行机用法：node scripts/diagnose-pinned-facts.mjs  （需 DB 在跑：dev:local 已启动）
import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_URL || "postgresql://postgres:password@127.0.0.1:5434/mirrai";
const PINNED_TYPES = ["user_fact", "promise", "preference"];

const client = new pg.Client({ connectionString: url });

function row(r) {
  return `#${r.id} [${r.status}] ${r.memorytype ?? r.memoryType} imp=${r.importance} conf=${r.confidence ?? "-"} | ${r.title}`;
}

async function main() {
  await client.connect();

  const personas = (await client.query(`SELECT id, name FROM personas ORDER BY id`)).rows;
  console.log("=== personas ===");
  personas.forEach(p => console.log(`  #${p.id}  ${p.name}`));
  const target = personas.find(p => (p.name || "").includes("王芃泽")) || personas[0];
  if (!target) { console.log("没有 persona"); return; }
  const id = target.id;
  console.log(`\n>>> 诊断 personaId=${id}（${target.name}）\n`);

  // 1) 所有含「课」的记忆
  const cls = (await client.query(
    `SELECT id, title, "memoryType" AS memorytype, importance, confidence, status, "createdAt"
       FROM memories
      WHERE "personaId"=$1 AND (title LIKE '%课%' OR COALESCE(description,'') LIKE '%课%')
      ORDER BY "createdAt" DESC`, [id])).rows;
  console.log(`=== 1) 含「课」的记忆（${cls.length} 条）===`);
  cls.forEach(r => console.log("  " + row(r)));

  // 2) 当前真正注入的前 6 条 pinned
  const pinned = (await client.query(
    `SELECT id, title, "memoryType" AS memorytype, importance, status
       FROM memories
      WHERE "personaId"=$1 AND status='active' AND "memoryType" = ANY($2) AND importance>=4
      ORDER BY importance DESC, "createdAt" DESC LIMIT 6`, [id, PINNED_TYPES])).rows;
  console.log(`\n=== 2) 当前注入的前 6 条 pinned 事实 ===`);
  pinned.forEach(r => console.log("  " + row({ ...r, confidence: "-" })));

  // 3) 够格 pinned 的总条数
  const total = (await client.query(
    `SELECT count(*)::int AS n FROM memories
      WHERE "personaId"=$1 AND status='active' AND "memoryType" = ANY($2) AND importance>=4`, [id, PINNED_TYPES])).rows[0].n;
  console.log(`\n=== 3) 够格 pinned 的总条数: ${total} ${total > 6 ? "（>6 → 可能被 limit 挤掉）" : ""}`);

  // ── 结论 ──────────────────────────────────────────────────────────
  const isClassDone = t => /结课|课.{0,2}结束|不.{0,2}上课|上完课|没课了|毕业|课程.{0,2}结束/.test(t || "");
  const doneRows = cls.filter(r => isClassDone(r.title));
  const pinnedIds = new Set(pinned.map(r => r.id));
  let verdict;
  if (doneRows.length === 0) {
    verdict = "C：没有任何「已结课」类记忆 —— consolidation 没把它存下来（或存成了别的措辞）。修法：让 consolidation 自动 pin 这类确认事实，或先手动 set-persona-pinned-fact 写一条。";
  } else {
    const active = doneRows.filter(r => r.status === "active");
    const blocked = doneRows.filter(r => r.status === "contradicted" || r.status === "archived");
    const lowImp = active.filter(r => r.importance < 4 || !PINNED_TYPES.includes(r.memorytype));
    const qualified = active.filter(r => r.importance >= 4 && PINNED_TYPES.includes(r.memorytype));
    if (blocked.length) {
      verdict = `B：「已结课」那条被治理标成了 ${blocked.map(r => r.status).join("/")} —— 被某条新记忆误判冲突。修法：治理保护高重要确认事实，不轻易 contradict/archive。涉及行: ${blocked.map(r => "#" + r.id).join(", ")}`;
    } else if (qualified.length && qualified.every(r => !pinnedIds.has(r.id))) {
      verdict = `A：「已结课」够格（active/类型对/imp>=4）但不在前 6 —— 被 limit=6 挤掉（总够格 ${total} 条）。修法：改 pinned 选取，让确认事实不被新事实挤掉。涉及行: ${qualified.map(r => "#" + r.id).join(", ")}`;
    } else if (lowImp.length) {
      verdict = `C：「已结课」存在但 importance<4 或类型不是 user_fact/promise/preference —— 不够格当 pinned。修法：提升其重要度/改类型，或让 consolidation 把确认事实存成高重要 user_fact。涉及行: ${lowImp.map(r => `#${r.id}(${r.memorytype},imp=${r.importance})`).join(", ")}`;
    } else if (qualified.some(r => pinnedIds.has(r.id))) {
      verdict = "意外：「已结课」其实就在前 6 条 pinned 里 —— 那问题不在数据层，可能是主动消息没读到/提示词被覆盖，需进一步看 ambient 链路。";
    } else {
      verdict = "需人工判断：见上面三段原始数据。";
    }
  }
  console.log(`\n========== 诊断结论 ==========\n${verdict}\n`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => client.end());
