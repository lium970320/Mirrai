import "dotenv/config";
import { sql } from "drizzle-orm";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { getDb } from "../server/db";

/**
 * 一次性脚本：把人物的「外貌描述」写进 personaData.appearance（系统提示会据此让人物知道自己长什么样），
 * 并把基准脸复制到 uploads/avatars 作为网页头像（avatarUrl）。在运行副本里跑：
 *   npx tsx scripts/set-persona-l0.ts
 */

const PERSONA_ID = Number(process.env.L0_PERSONA_ID ?? "1");
const BASE_FACE = process.env.PERSONA_SELFIE_BASE_FACE_PATH
  ?? "F:\\.mirrai-local\\Mirrai\\chatgpt-20260428-005140-file_0000000068a871fd927ed4c677996ba5.png";

const APPEARANCE =
  "成年亚洲男性，三十多岁，成熟稳重。黑色圆寸短发，圆中带方的饱满脸型，下巴有淡淡胡渣，"
  + "笑起来眼睛会微微弯起，温和好亲近。体型壮实、肩背厚实、有分量感，是让人有安全感的体格。"
  + "平时穿得简洁居家——浅色纯棉短袖配深色休闲短裤那一类。整体气质温和、踏实、顾家。";

async function main() {
  // 1. 复制基准脸到 uploads/avatars（web 可访问的静态目录）
  let avatarUrl: string | null = null;
  if (existsSync(BASE_FACE)) {
    const uploadsDir = path.resolve(process.env.UPLOAD_DIR ?? "uploads", "avatars");
    mkdirSync(uploadsDir, { recursive: true });
    copyFileSync(BASE_FACE, path.join(uploadsDir, `persona-${PERSONA_ID}.png`));
    avatarUrl = `/uploads/avatars/persona-${PERSONA_ID}.png`;
  } else {
    console.warn(`基准脸不存在，跳过头像复制：${BASE_FACE}`);
  }

  // 2. 写库：外貌写进 personaData.appearance 顶层（normalize 读取时兜底到 core.appearance）+ avatarUrl
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const result = await db.execute(sql`
    UPDATE personas
    SET "avatarUrl" = COALESCE(${avatarUrl}, "avatarUrl"),
        "personaData" = jsonb_set(
          COALESCE("personaData", '{}'::jsonb),
          '{appearance}',
          ${JSON.stringify(APPEARANCE)}::jsonb
        )
    WHERE id = ${PERSONA_ID}
    RETURNING id, name, "avatarUrl"
  `);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? result;
  console.log(`L0 写入完成 persona=${PERSONA_ID} 外貌=${APPEARANCE.length}字 avatarUrl=${avatarUrl ?? "(未变)"}`);
  console.log("受影响行:", JSON.stringify(rows));
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
