#!/usr/bin/env node
import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { checkDatabaseSchema, printSchemaCheckHuman } from "./check-db-migrations.mjs";

const { Client } = pg;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(rootDir);

const DEFAULT_LOCAL_URL = "postgresql://postgres:password@127.0.0.1:5434/mirrai";
const DEFAULT_APP_TABLES = [
  "users",
  "personas",
  "persona_files",
  "persona_sources",
  "persona_source_chunks",
  "messages",
  "wechat_bindings",
  "skill_jobs",
  "llm_configs",
  "wechat_bot_state",
  "memories",
  "emotion_snapshots",
  "diary_entries",
  "scenes",
];

const PLAN2_COMPATIBILITY_MIGRATIONS = [
  "0003_roleplay_channels.sql",
  "0004_structured_memory_cards.sql",
  "0005_qq_message_channel.sql",
  "0006_llm_usage_records.sql",
  "0007_llm_usage_attribution.sql",
  "0008_persona_runtime_states.sql",
];

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) {
      args._.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function firstNonEmpty(...values) {
  return values.find(value => typeof value === "string" && value.trim())?.trim() || "";
}

function localDataRoot() {
  return path.resolve(
    process.env.MIRRAI_LOCAL_DATA_DIR ||
      (process.platform === "win32"
        ? path.join(path.parse(rootDir).root, ".mirrai-local", "Mirrai")
        : path.join(rootDir, ".mirrai-local"))
  );
}

function resolveLocalUrl(args) {
  return firstNonEmpty(args.target, process.env.LOCAL_DATABASE_URL, process.env.MIRRAI_LOCAL_DATABASE_URL) || DEFAULT_LOCAL_URL;
}

function resolveSourceUrl(args) {
  const source = firstNonEmpty(args.source, process.env.NEON_DATABASE_URL, process.env.SOURCE_DATABASE_URL);
  if (source) return source;
  const current = firstNonEmpty(process.env.DATABASE_URL);
  if (!current) return "";
  return isLocalDatabaseUrl(current) ? "" : current;
}

function redactDatabaseUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.password) url.password = "******";
    if (url.username) url.username = url.username ? "******" : "";
    return url.toString();
  } catch {
    return "******";
  }
}

function isLocalDatabaseUrl(value) {
  try {
    const host = new URL(value).hostname;
    return ["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    return false;
  }
}

function localPostgresConfig(databaseUrl) {
  const url = new URL(databaseUrl);
  const host = url.hostname || "localhost";
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Local database URL must use localhost/127.0.0.1, got ${host}`);
  }

  return {
    host,
    port: Number(url.port || "5432"),
    database: decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "mirrai",
    user: decodeURIComponent(url.username || "postgres"),
    password: decodeURIComponent(url.password || "password"),
  };
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function tableSql(tableName) {
  return `${quoteIdent("public")}.${quoteIdent(tableName)}`;
}

function binModule(command) {
  if (command === "drizzle-kit") return path.join(rootDir, "node_modules", "drizzle-kit", "bin.cjs");
  throw new Error(`Unknown local binary: ${command}`);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binModule(command), ...args], {
      cwd: rootDir,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function getPgBinaries() {
  const embeddedIndex = fileURLToPath(import.meta.resolve("embedded-postgres"));
  const binaryUrl = pathToFileURL(path.join(path.dirname(embeddedIndex), "binary.js")).href;
  const { default: getBinaries } = await import(binaryUrl);
  return getBinaries();
}

function runBinary(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: rootDir,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: options.stdio || "inherit",
    });
    const timeout = options.timeoutMs
      ? setTimeout(() => {
        child.kill();
        reject(new Error(`${path.basename(file)} ${args.join(" ")} timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs)
      : null;

    child.on("error", error => {
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", code => {
      if (timeout) clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(file)} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function createLocalPostgresController(databaseUrl) {
  const config = localPostgresConfig(databaseUrl);
  const dataRoot = localDataRoot();
  const databaseDir = path.resolve(process.env.MIRRAI_PGDATA || path.join(dataRoot, "postgres-main"));
  const binaries = await getPgBinaries();
  const logRoot = path.join(dataRoot, "logs");
  const logFile = path.join(logRoot, "postgres-local-db.log");

  return {
    databaseDir,
    config,
    async initialise() {
      await mkdir(databaseDir, { recursive: true });
      await mkdir(logRoot, { recursive: true });
      if (existsSync(path.join(databaseDir, "PG_VERSION"))) return;

      const passwordFile = path.join(dataRoot, "postgres-local-password.tmp");
      await writeFile(passwordFile, `${config.password}\n`, "utf8");
      try {
        console.log(`[local-db] Initialising PostgreSQL data directory at ${databaseDir}`);
        await runBinary(binaries.initdb, [
          `--pgdata=${databaseDir}`,
          "--auth=password",
          `--username=${config.user}`,
          `--pwfile=${passwordFile}`,
        ], { timeoutMs: 120_000 });
      } finally {
        await rm(passwordFile, { force: true }).catch(() => undefined);
      }
    },
    async start() {
      await this.initialise();
      console.log(`[local-db] Starting PostgreSQL with pg_ctl on 127.0.0.1:${config.port}`);
      await runBinary(binaries.pg_ctl, [
        "-D", databaseDir,
        "-l", logFile,
        "-o", `-p ${config.port} -h 127.0.0.1`,
        "-w",
        "start",
      ], { timeoutMs: 60_000 });
    },
    async stop() {
      if (!existsSync(path.join(databaseDir, "postmaster.pid"))) return;
      await runBinary(binaries.pg_ctl, [
        "-D", databaseDir,
        "-m", "fast",
        "-w",
        "stop",
      ], { timeoutMs: 60_000 }).catch(error => {
        console.warn(`[local-db] pg_ctl stop failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
  };
}

async function startLocalPostgres(databaseUrl) {
  const postgres = await createLocalPostgresController(databaseUrl);
  await postgres.start();
  const { config } = postgres;
  const adminClient = new Client({
    user: config.user,
    password: config.password,
    host: "127.0.0.1",
    port: config.port,
    database: "postgres",
    connectionTimeoutMillis: 10_000,
  });
  try {
    await adminClient.connect();
    await adminClient.query(`CREATE DATABASE ${quoteIdent(config.database)}`);
    console.log(`[local-db] Created database ${config.database}`);
  } catch (error) {
    if (error?.code === "42P04" || /already exists/i.test(String(error?.message))) {
      console.log(`[local-db] Database ${config.database} already exists`);
    } else {
      throw error;
    }
  } finally {
    await adminClient.end().catch(() => undefined);
  }

  return postgres;
}

async function runMigrations(databaseUrl) {
  const migrationOut = path.resolve(process.env.MIRRAI_DRIZZLE_OUT || path.join(localDataRoot(), "drizzle-local"));
  await mkdir(migrationOut, { recursive: true });
  const drizzleOut = path.relative(rootDir, migrationOut) || ".";

  console.log("[local-db] Generating local database migration metadata");
  await runCommand("drizzle-kit", ["generate"], {
    env: { DATABASE_URL: databaseUrl, DRIZZLE_OUT: drizzleOut },
  });

  console.log("[local-db] Running local database migrations");
  await runCommand("drizzle-kit", ["migrate"], {
    env: { DATABASE_URL: databaseUrl, DRIZZLE_OUT: drizzleOut },
  });
}

function splitMigrationStatements(sql) {
  return sql
    .replace(/^\uFEFF/, "")
    .split(/-->\s*statement-breakpoint/g)
    .map(statement => statement.trim())
    .filter(Boolean);
}

async function applyPlan2CompatibilityMigrations(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    for (const fileName of PLAN2_COMPATIBILITY_MIGRATIONS) {
      const filePath = path.join(rootDir, "drizzle", fileName);
      const sql = await readFile(filePath, "utf8");
      const statements = splitMigrationStatements(sql);
      console.log(`[local-db] Applying compatibility migration ${fileName}`);
      for (const statement of statements) {
        await client.query(statement);
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function getExistingApplicationTables(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const tables = await getPublicTables(client);
    return new Set(tables);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function ensureSchema(databaseUrl) {
  const existing = await getExistingApplicationTables(databaseUrl);
  const hasCoreSchema = ["users", "personas", "messages", "memories"].every(table => existing.has(table));
  if (hasCoreSchema) {
    const summary = await checkDatabaseSchema(databaseUrl, { json: true });
    if (summary.ok) {
      console.log("[local-db] Existing Plan2 application schema detected; skipping migrations");
      return;
    }

    console.log(`[local-db] Existing schema is missing ${summary.missingCount} Plan2 item(s); applying compatibility migrations`);
    await applyPlan2CompatibilityMigrations(databaseUrl);
  } else {
    await runMigrations(databaseUrl);
    await applyPlan2CompatibilityMigrations(databaseUrl);
  }

  const summary = await checkDatabaseSchema(databaseUrl, { json: true });
  if (!summary.ok) {
    printSchemaCheckHuman(summary);
    throw new Error(`Local database schema is still missing ${summary.missingCount} Plan2 item(s) after migrations.`);
  }
}

async function getPublicTables(client) {
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return result.rows.map(row => row.table_name).filter(name => !name.startsWith("__drizzle"));
}

async function getColumns(client, tableName) {
  const result = await client.query(`
    SELECT column_name, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = $1
    ORDER BY ordinal_position
  `, [tableName]);
  return result.rows;
}

async function getCopyTables(sourceClient, targetClient) {
  const sourceTables = new Set(await getPublicTables(sourceClient));
  const targetTables = new Set(await getPublicTables(targetClient));
  const configured = DEFAULT_APP_TABLES.filter(table => sourceTables.has(table) && targetTables.has(table));
  const extra = Array.from(targetTables)
    .filter(table => sourceTables.has(table) && !DEFAULT_APP_TABLES.includes(table))
    .sort();
  return [...configured, ...extra];
}

function serializeValue(value) {
  if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return JSON.stringify(value);
  }
  return value;
}

async function truncateTarget(client, tables) {
  if (tables.length === 0) return;
  const tableList = tables.map(tableSql).join(", ");
  console.log(`[local-db] Clearing target tables (${tables.length})`);
  await client.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}

async function copyTable(sourceClient, targetClient, tableName, batchSize = 500) {
  const sourceColumns = await getColumns(sourceClient, tableName);
  const targetColumns = await getColumns(targetClient, tableName);
  const targetColumnNames = new Set(targetColumns.map(column => column.column_name));
  const columns = sourceColumns.map(column => column.column_name).filter(column => targetColumnNames.has(column));
  if (columns.length === 0) {
    console.log(`[local-db] ${tableName}: skipped, no common columns`);
    return 0;
  }

  const columnSql = columns.map(quoteIdent).join(", ");
  const sourceResult = await sourceClient.query(`SELECT ${columnSql} FROM ${tableSql(tableName)}`);
  const rows = sourceResult.rows;
  if (rows.length === 0) {
    console.log(`[local-db] ${tableName}: 0 rows`);
    return 0;
  }

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const values = [];
    const placeholders = batch.map((row, rowIndex) => {
      const inner = columns.map((column, columnIndex) => {
        values.push(serializeValue(row[column]));
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${inner.join(", ")})`;
    });

    await targetClient.query(
      `INSERT INTO ${tableSql(tableName)} (${columnSql}) VALUES ${placeholders.join(", ")}`,
      values,
    );
  }

  console.log(`[local-db] ${tableName}: copied ${rows.length} rows`);
  return rows.length;
}

async function resetSequences(client, tables) {
  for (const tableName of tables) {
    const columns = await getColumns(client, tableName);
    for (const column of columns) {
      if (!String(column.column_default || "").startsWith("nextval(")) continue;
      const table = tableSql(tableName);
      const col = quoteIdent(column.column_name);
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence($1, $2),
          COALESCE((SELECT MAX(${col}) FROM ${table}), 1),
          (SELECT MAX(${col}) FROM ${table}) IS NOT NULL
        )
      `, [tableName, column.column_name]);
    }
  }
}

async function prepareLocalDatabase(localUrl) {
  let postgres;
  try {
    postgres = await startLocalPostgres(localUrl);
    await ensureSchema(localUrl);
    console.log("[local-db] Local database is ready");
  } finally {
    if (postgres) await postgres.stop().catch(() => undefined);
  }
}

async function checkLocalDatabase(localUrl) {
  let postgres;
  try {
    postgres = await startLocalPostgres(localUrl);
    const summary = await checkDatabaseSchema(localUrl);
    if (!summary.ok) {
      throw new Error(`Local database schema is missing ${summary.missingCount} Plan2 item(s). Run corepack pnpm run db:local:prepare.`);
    }
  } finally {
    if (postgres) await postgres.stop().catch(() => undefined);
  }
}

async function copyDatabase(sourceUrl, localUrl, options = {}) {
  if (!sourceUrl) {
    throw new Error("Source Neon database URL is missing. Set NEON_DATABASE_URL, SOURCE_DATABASE_URL, or keep DATABASE_URL pointed at Neon.");
  }
  if (isLocalDatabaseUrl(sourceUrl)) {
    throw new Error("Source database URL points to localhost. Refusing to copy local database onto itself.");
  }

  let postgres;
  const sourceClient = new Client({ connectionString: sourceUrl });
  const targetClient = new Client({ connectionString: localUrl });
  try {
    postgres = await startLocalPostgres(localUrl);
    await ensureSchema(localUrl);

    console.log(`[local-db] Source: ${redactDatabaseUrl(sourceUrl)}`);
    console.log(`[local-db] Target: ${redactDatabaseUrl(localUrl)}`);
    await sourceClient.connect();
    await targetClient.connect();

    const tables = await getCopyTables(sourceClient, targetClient);
    if (tables.length === 0) throw new Error("No common application tables found to copy.");
    console.log(`[local-db] Tables: ${tables.join(", ")}`);

    let totalRows = 0;
    await targetClient.query("BEGIN");
    try {
      if (!options.noTruncate) {
        await truncateTarget(targetClient, tables);
      }

      for (const table of tables) {
        totalRows += await copyTable(sourceClient, targetClient, table, options.batchSize);
      }
      await resetSequences(targetClient, tables);
      await targetClient.query("COMMIT");
    } catch (error) {
      await targetClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    console.log(`[local-db] Copy complete: ${totalRows} rows`);
  } finally {
    await sourceClient.end().catch(() => undefined);
    await targetClient.end().catch(() => undefined);
    if (postgres) await postgres.stop().catch(() => undefined);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "help";
  const localUrl = resolveLocalUrl(args);

  if (command === "prepare") {
    await prepareLocalDatabase(localUrl);
    console.log(`[local-db] Prepared without changing .env. Local URL: ${redactDatabaseUrl(localUrl)}`);
    return;
  }

  if (command === "check") {
    await checkLocalDatabase(localUrl);
    console.log(`[local-db] Checked without changing .env. Local URL: ${redactDatabaseUrl(localUrl)}`);
    return;
  }

  if (command === "copy") {
    await copyDatabase(resolveSourceUrl(args), localUrl, {
      noTruncate: Boolean(args["no-truncate"]),
      batchSize: Number.parseInt(args["batch-size"] || "500", 10) || 500,
    });
    console.log("[local-db] Neon data has been copied to the local database. .env was not changed.");
    return;
  }

  console.log([
    "Usage:",
    "  corepack pnpm run db:local:prepare",
    "  corepack pnpm run db:local:check",
    "  corepack pnpm run db:local:copy",
    "",
    "Environment:",
    `  LOCAL_DATABASE_URL=${DEFAULT_LOCAL_URL}`,
    "  NEON_DATABASE_URL=<optional source override>",
    "",
    "This script never edits .env. Switch DATABASE_URL only after copy verification.",
  ].join("\n"));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
