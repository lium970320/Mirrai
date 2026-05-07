#!/usr/bin/env node
import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

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
const databaseDir = path.resolve(process.env.MIRRAI_PGDATA || path.join(localDataRoot, "postgres"));
const migrationOut = path.resolve(process.env.MIRRAI_DRIZZLE_OUT || path.join(localDataRoot, "drizzle"));
const drizzleOut = path.relative(rootDir, migrationOut) || ".";

const postgres = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port,
  persistent: true,
  onLog: message => {
    const text = String(message).trim();
    if (text) console.log(`[postgres] ${text}`);
  },
  onError: message => {
    const text = String(message).trim();
    if (text) console.error(`[postgres] ${text}`);
  },
});

let appProcess;
let stopping = false;

async function ensureCluster() {
  await mkdir(databaseDir, { recursive: true });
  if (!existsSync(path.join(databaseDir, "PG_VERSION"))) {
    console.log(`[local-db] Initialising PostgreSQL data directory at ${databaseDir}`);
    await postgres.initialise();
  }

  console.log(`[local-db] Starting PostgreSQL on ${host}:${port}`);
  await postgres.start();
}

async function ensureDatabase() {
  try {
    await postgres.createDatabase(database);
    console.log(`[local-db] Created database ${database}`);
  } catch (error) {
    if (error?.code === "42P04" || /already exists/i.test(String(error?.message))) {
      console.log(`[local-db] Database ${database} already exists`);
      return;
    }
    throw error;
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
  console.log("[local-db] Generating database migration metadata");
  await runCommand("drizzle-kit", ["generate"], {
    env: { DATABASE_URL: databaseUrl, DRIZZLE_OUT: drizzleOut },
  });

  console.log("[local-db] Running database migrations");
  await runCommand("drizzle-kit", ["migrate"], {
    env: { DATABASE_URL: databaseUrl, DRIZZLE_OUT: drizzleOut },
  });
}

async function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (appProcess && !appProcess.killed) appProcess.kill();
  await postgres.stop().catch(() => undefined);
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
    stdio: "inherit",
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
