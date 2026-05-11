import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const DEFAULT_EPUB = "C:/Users/Lenovo/Downloads/爱人随风而来-完整版_南无.epub";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function chunkSection(section, maxChars = 950, overlapChars = 120) {
  const paragraphs = section.text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n${paragraph}` : paragraph;
    if (Array.from(next).length <= maxChars) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    if (Array.from(paragraph).length > maxChars) {
      const chars = Array.from(paragraph);
      for (let i = 0; i < chars.length; i += maxChars - overlapChars) {
        chunks.push(chars.slice(i, i + maxChars).join(""));
      }
      current = "";
    } else {
      current = paragraph;
    }
  }
  if (current) chunks.push(current);

  return chunks
    .map(content => ({
      chapterTitle: section.title || path.basename(section.href),
      content,
    }))
    .filter(chunk => Array.from(chunk.content).length >= 80);
}

function extractKeywords(text) {
  const keywords = new Set();
  const known = [
    "王芃泽", "王玉柱", "柱子", "敏子", "姚敏", "王小川", "林慧珍",
    "老赵", "小刘", "大刘", "小彭", "南京", "北京", "西北", "湾子村",
    "老鹰峡", "研究所", "地质", "左臂", "车祸", "表白", "亲吻",
  ];
  for (const word of known) {
    if (text.includes(word)) keywords.add(word);
  }
  return Array.from(keywords);
}

async function ensureTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "persona_sources" (
      "id" serial PRIMARY KEY NOT NULL,
      "personaId" integer NOT NULL,
      "userId" integer NOT NULL,
      "title" varchar(255) NOT NULL,
      "sourceType" varchar(50) DEFAULT 'epub' NOT NULL,
      "originalName" varchar(255),
      "fileHash" varchar(128),
      "metadata" jsonb,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS "persona_source_chunks" (
      "id" serial PRIMARY KEY NOT NULL,
      "sourceId" integer NOT NULL,
      "personaId" integer NOT NULL,
      "userId" integer NOT NULL,
      "chapterTitle" text,
      "chunkIndex" integer NOT NULL,
      "content" text NOT NULL,
      "keywords" jsonb,
      "tokenEstimate" integer,
      "createdAt" timestamp DEFAULT now() NOT NULL
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS "persona_sources_persona_user_idx" ON "persona_sources" ("personaId", "userId")`);
  await client.query(`CREATE INDEX IF NOT EXISTS "persona_source_chunks_persona_user_idx" ON "persona_source_chunks" ("personaId", "userId")`);
  await client.query(`CREATE INDEX IF NOT EXISTS "persona_source_chunks_source_idx" ON "persona_source_chunks" ("sourceId")`);
}

async function resolvePersona(client, personaIdArg) {
  if (personaIdArg) {
    const { rows } = await client.query(`select id, "userId", name from personas where id = $1`, [Number(personaIdArg)]);
    if (!rows[0]) throw new Error(`Persona ${personaIdArg} not found`);
    return rows[0];
  }
  const { rows } = await client.query(`select id, "userId", name from personas where "analysisStatus" = 'ready' order by id asc limit 1`);
  if (!rows[0]) throw new Error("No ready persona found");
  return rows[0];
}

function runExtractor(epubPath) {
  const python = process.env.PYTHON_PATH || "python";
  const script = path.resolve("scripts", "extract-epub-text.py");
  const result = spawnSync(python, [script, epubPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `EPUB extractor failed with exit code ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

function buildChunks(sections) {
  const chunks = [];
  for (const section of sections) {
    chunks.push(...chunkSection(section));
  }
  return chunks.map((chunk, index) => ({
    ...chunk,
    chunkIndex: index,
    keywords: extractKeywords(`${chunk.chapterTitle}\n${chunk.content}`),
    tokenEstimate: Math.ceil(Array.from(chunk.content).length / 1.7),
  }));
}

async function insertChunks(client, sourceId, persona, chunks) {
  const batchSize = 80;
  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    const values = [];
    const placeholders = [];
    for (const chunk of batch) {
      const offset = values.length;
      values.push(
        sourceId,
        persona.id,
        persona.userId,
        chunk.chapterTitle,
        chunk.chunkIndex,
        chunk.content,
        JSON.stringify(chunk.keywords),
        chunk.tokenEstimate,
      );
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}::jsonb, $${offset + 8})`);
    }
    await client.query(`
      insert into "persona_source_chunks"
        ("sourceId", "personaId", "userId", "chapterTitle", "chunkIndex", "content", "keywords", "tokenEstimate")
      values ${placeholders.join(",")}
    `, values);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const epubPath = path.resolve(String(args.file || DEFAULT_EPUB));
  if (!fs.existsSync(epubPath)) throw new Error(`EPUB not found: ${epubPath}`);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");

  const fileBuffer = fs.readFileSync(epubPath);
  const fileHash = createHash("sha256").update(fileBuffer).digest("hex");
  const parsed = runExtractor(epubPath);
  const title = String(args.title || parsed.metadata?.title || "爱人随风而来");
  const originalName = path.basename(epubPath);
  const chunks = buildChunks(parsed.sections || []);
  if (chunks.length === 0) throw new Error("No usable text chunks were extracted");

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await ensureTables(client);
    const persona = await resolvePersona(client, args["persona-id"]);

    await client.query("begin");
    const existing = await client.query(
      `select id from "persona_sources" where "personaId" = $1 and "userId" = $2 and ("originalName" = $3 or "fileHash" = $4)`,
      [persona.id, persona.userId, originalName, fileHash],
    );
    const existingIds = existing.rows.map(row => row.id);
    if (existingIds.length) {
      await client.query(`delete from "persona_source_chunks" where "sourceId" = any($1::int[])`, [existingIds]);
      await client.query(`delete from "persona_sources" where id = any($1::int[])`, [existingIds]);
    }

    const inserted = await client.query(`
      insert into "persona_sources"
        ("personaId", "userId", "title", "sourceType", "originalName", "fileHash", "metadata")
      values ($1, $2, $3, 'epub', $4, $5, $6::jsonb)
      returning id
    `, [
      persona.id,
      persona.userId,
      title,
      originalName,
      fileHash,
      JSON.stringify({ ...parsed.metadata, importedAt: new Date().toISOString() }),
    ]);
    const sourceId = inserted.rows[0].id;
    await insertChunks(client, sourceId, persona, chunks);
    await client.query("commit");

    console.log(JSON.stringify({
      ok: true,
      personaId: persona.id,
      personaName: persona.name,
      sourceId,
      title,
      originalName,
      sections: parsed.sections?.length || 0,
      chunks: chunks.length,
    }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
