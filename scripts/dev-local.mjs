#!/usr/bin/env node
import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(rootDir);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and configure it first.");
}

const url = new URL(databaseUrl);
const host = url.hostname || "localhost";
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  throw new Error(`dev:local only manages local PostgreSQL hosts, got ${host}.`);
}

const database = decodeURIComponent(url.pathname.replace(/^\/+/, "")) || "mirrai";
const user = decodeURIComponent(url.username || "postgres");
const password = decodeURIComponent(url.password || "password");
const port = Number(url.port || "5432");
const localDataRoot = path.resolve(
  process.env.MIRRAI_LOCAL_DATA_DIR ||
    (process.platform === "win32"
      ? path.join(path.parse(rootDir).root, ".mirrai-local", "Mirrai")
      : path.join(rootDir, ".mirrai-local"))
);
const databaseDir = path.resolve(process.env.MIRRAI_PGDATA || path.join(localDataRoot, "postgres-main"));
const migrationOut = path.resolve(process.env.MIRRAI_DRIZZLE_OUT || path.join(localDataRoot, "drizzle"));
const drizzleOut = path.relative(rootDir, migrationOut) || ".";

const PLAN2_COMPATIBILITY_MIGRATIONS = [
  "0003_roleplay_channels.sql",
  "0004_structured_memory_cards.sql",
  "0005_qq_message_channel.sql",
  "0006_llm_usage_records.sql",
  "0007_llm_usage_attribution.sql",
  "0008_persona_runtime_states.sql",
];

let appProcess;
let postgresController;
let stopping = false;

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

async function createPostgresController() {
  const binaries = await getPgBinaries();
  const logRoot = path.join(localDataRoot, "logs");
  const logFile = path.join(logRoot, "postgres-dev-local.log");

  return {
    async initialise() {
      await mkdir(databaseDir, { recursive: true });
      await mkdir(logRoot, { recursive: true });
      if (existsSync(path.join(databaseDir, "PG_VERSION"))) return;

      const passwordFile = path.join(localDataRoot, "postgres-dev-local-password.tmp");
      await writeFile(passwordFile, `${password}\n`, "utf8");
      try {
        console.log(`[local-db] Initialising PostgreSQL data directory at ${databaseDir}`);
        await runBinary(binaries.initdb, [
          `--pgdata=${databaseDir}`,
          "--auth=password",
          `--username=${user}`,
          `--pwfile=${passwordFile}`,
        ], { timeoutMs: 120_000 });
      } finally {
        await rm(passwordFile, { force: true }).catch(() => undefined);
      }
    },
    async start() {
      await this.initialise();
      console.log(`[local-db] Starting PostgreSQL with pg_ctl on 127.0.0.1:${port}`);
      await runBinary(binaries.pg_ctl, [
        "-D", databaseDir,
        "-l", logFile,
        "-o", `-p ${port} -h 127.0.0.1`,
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

async function ensureCluster() {
  postgresController = await createPostgresController();
  await postgresController.start();
}

async function ensureDatabase() {
  const client = new Client({
    user,
    password,
    host: "127.0.0.1",
    port,
    database: "postgres",
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    console.log(`[local-db] Created database ${database}`);
  } catch (error) {
    if (error?.code === "42P04" || /already exists/i.test(String(error?.message))) {
      console.log(`[local-db] Database ${database} already exists`);
      return;
    }
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function binModule(command) {
  if (command === "drizzle-kit") return path.join(rootDir, "node_modules", "drizzle-kit", "bin.cjs");
  if (command === "tsx") return path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");
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

async function runMigrations() {
  if (await hasCoreSchema()) {
    console.log("[local-db] Existing application schema detected; applying compatibility migrations");
    await applyCompatibilityMigrations();
    return;
  }

  console.log("[local-db] Generating database migration metadata");
  await runCommand("drizzle-kit", ["generate"], {
    env: { DATABASE_URL: databaseUrl, DRIZZLE_OUT: drizzleOut },
  });

  console.log("[local-db] Running database migrations");
  await runCommand("drizzle-kit", ["migrate"], {
    env: { DATABASE_URL: databaseUrl, DRIZZLE_OUT: drizzleOut },
  });
  await applyCompatibilityMigrations();
}

async function hasCoreSchema() {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
    `, [["users", "personas", "messages", "memories"]]);
    return result.rows.length === 4;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function splitMigrationStatements(sql) {
  return sql
    .replace(/^\uFEFF/, "")
    .split(/-->\s*statement-breakpoint/g)
    .map(statement => statement.trim())
    .filter(Boolean);
}

async function applyCompatibilityMigrations() {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    for (const fileName of PLAN2_COMPATIBILITY_MIGRATIONS) {
      const filePath = path.join(rootDir, "drizzle", fileName);
      const sql = await readFile(filePath, "utf8");
      console.log(`[local-db] Applying compatibility migration ${fileName}`);
      for (const statement of splitMigrationStatements(sql)) {
        await client.query(statement);
      }
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (appProcess && !appProcess.killed) appProcess.kill();
  if (postgresController) await postgresController.stop().catch(() => undefined);
  process.exit(exitCode);
}

async function main() {
  await ensureCluster();
  await ensureDatabase();
  await runMigrations();

  console.log("[local-db] Ready");
  appProcess = spawn(process.execPath, [binModule("tsx"), "watch", "server/_core/index.ts"], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: databaseUrl,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  appProcess.on("exit", code => void stopAll(code ?? 0));
  appProcess.on("error", error => {
    console.error(error);
    void stopAll(1);
  });
}

process.on("SIGINT", () => void stopAll(0));
process.on("SIGTERM", () => void stopAll(0));
process.on("uncaughtException", error => {
  console.error(error);
  void stopAll(1);
});

main().catch(error => {
  console.error(error);
  void stopAll(1);
});
