#!/usr/bin/env node
import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

const REQUIRED_TABLES = [
  "roleplay_channels",
  "roleplay_channel_members",
  "roleplay_messages",
  "llm_usage_records",
  "persona_runtime_states",
];

const REQUIRED_COLUMNS = {
  memories: [
    "source",
    "memoryType",
    "importance",
    "confidence",
    "keywords",
    "emotion",
    "validFrom",
    "validTo",
    "lastAccessedAt",
    "evidenceMessageIds",
    "status",
  ],
  llm_usage_records: [
    "userId",
    "personaId",
    "route",
  ],
  persona_runtime_states: [
    "personaId",
    "userId",
    "runtimeLifeState",
    "runtimeDiagnostics",
    "proactiveRuntime",
  ],
};

const REQUIRED_INDEXES = [
  "roleplay_channels_user_idx",
  "roleplay_members_channel_idx",
  "roleplay_members_channel_persona_idx",
  "roleplay_messages_channel_idx",
  "memories_persona_user_status_idx",
  "memories_type_idx",
  "memories_last_accessed_idx",
  "llm_usage_started_at_idx",
  "llm_usage_provider_started_idx",
  "llm_usage_purpose_started_idx",
  "llm_usage_user_started_idx",
  "llm_usage_persona_started_idx",
  "llm_usage_route_started_idx",
  "persona_runtime_states_persona_user_idx",
  "persona_runtime_states_user_idx",
];

const REQUIRED_ENUM_VALUES = [
  { type: "channel", value: "qq" },
];

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    json: args.has("--json"),
    strict: args.has("--strict"),
  };
}

function groupByStatus(items) {
  return items.reduce((groups, item) => {
    const key = item.ok ? "ok" : "missing";
    groups[key].push(item);
    return groups;
  }, { ok: [], missing: [] });
}

async function tableExists(client, tableName) {
  const result = await client.query(
    `select 1 from information_schema.tables where table_schema = 'public' and table_name = $1 limit 1`,
    [tableName],
  );
  return result.rowCount > 0;
}

async function columnExists(client, tableName, columnName) {
  const result = await client.query(
    `select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2 limit 1`,
    [tableName, columnName],
  );
  return result.rowCount > 0;
}

async function indexExists(client, indexName) {
  const result = await client.query(
    `select 1 from pg_indexes where schemaname = 'public' and indexname = $1 limit 1`,
    [indexName],
  );
  return result.rowCount > 0;
}

async function enumValueExists(client, typeName, enumValue) {
  const result = await client.query(
    `
      select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = $1 and e.enumlabel = $2
      limit 1
    `,
    [typeName, enumValue],
  );
  return result.rowCount > 0;
}

export async function collectDatabaseSchemaChecks(client) {
  const tables = [];
  for (const table of REQUIRED_TABLES) {
    tables.push({ name: table, ok: await tableExists(client, table) });
  }

  const columns = [];
  for (const [table, columnNames] of Object.entries(REQUIRED_COLUMNS)) {
    for (const column of columnNames) {
      columns.push({
        name: `${table}.${column}`,
        table,
        column,
        ok: await columnExists(client, table, column),
      });
    }
  }

  const indexes = [];
  for (const index of REQUIRED_INDEXES) {
    indexes.push({ name: index, ok: await indexExists(client, index) });
  }

  const enumValues = [];
  for (const item of REQUIRED_ENUM_VALUES) {
    enumValues.push({
      name: `${item.type}.${item.value}`,
      type: item.type,
      value: item.value,
      ok: await enumValueExists(client, item.type, item.value),
    });
  }

  return { tables, columns, indexes, enumValues };
}

export function summarizeDatabaseSchemaChecks(checks) {
  const sections = Object.fromEntries(
    Object.entries(checks).map(([key, items]) => [key, groupByStatus(items)]),
  );
  const missing = Object.values(sections).flatMap(section => section.missing);
  return {
    ok: missing.length === 0,
    missingCount: missing.length,
    sections,
  };
}

export function printSchemaCheckHuman(summary) {
  console.log("Mirrai Plan2 database schema check");
  console.log(`Status: ${summary.ok ? "OK" : "MISSING"} (${summary.missingCount} missing)`);

  for (const [sectionName, section] of Object.entries(summary.sections)) {
    console.log("");
    console.log(`${sectionName}: ${section.ok.length} ok, ${section.missing.length} missing`);
    if (section.missing.length > 0) {
      for (const item of section.missing) {
        console.log(`  - missing ${item.name}`);
      }
    }
  }

  if (!summary.ok) {
    console.log("");
    console.log("Run migrations from the local worktree after confirming DATABASE_URL points to the intended database:");
    console.log("  corepack pnpm run db:migrate");
  }
}

function sanitizeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(
    /postgres(?:ql)?:\/\/[^@\s]+@/gi,
    "postgresql://<redacted>@",
  );
}

function printConnectionAdvice(error) {
  const message = sanitizeErrorMessage(error);
  console.error(`Database schema check failed: ${message}`);
  console.error("");
  console.error("This check is read-only and does not run migrations.");
  console.error("Confirm DATABASE_URL points to the intended local or Neon database, then start the database if needed.");
  console.error("Common local command:");
  console.error("  corepack pnpm run db:local:prepare");
}

export async function checkDatabaseSchema(connectionString, options = {}) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured. Keep .env in the local worktree, not in the Google Drive source folder.");
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
    const checks = await collectDatabaseSchemaChecks(client);
    const summary = summarizeDatabaseSchemaChecks(checks);
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printSchemaCheckHuman(summary);
    }
    return summary;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await checkDatabaseSchema(process.env.DATABASE_URL, options);
  if (!summary.ok && options.strict) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    printConnectionAdvice(error);
    process.exit(1);
  });
}
