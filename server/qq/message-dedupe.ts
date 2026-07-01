import fs from "fs/promises";
import path from "path";
import { ENV } from "../_core/env";

type ContactState = {
  seenMessageIds: string[];
  updatedAt?: string;
};

type DedupeState = {
  version: 1;
  contacts: Record<string, ContactState>;
};

const MAX_SEEN_IDS_PER_CONTACT = 300;
let cachedState: DedupeState | null = null;
let writeChain: Promise<void> = Promise.resolve();

function runtimeRoot(): string {
  const configured = process.env.MIRRAI_LOCAL_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);

  if (process.platform === "win32") {
    const driveRoot = path.parse(process.cwd()).root || "F:\\";
    return path.join(driveRoot, ".mirrai-local", "Mirrai");
  }

  const uploadDir = path.resolve(ENV.uploadDir || "./uploads");
  if (path.basename(uploadDir).toLowerCase() === "uploads") return path.dirname(uploadDir);
  return path.dirname(uploadDir);
}

function statePath(): string {
  return path.join(runtimeRoot(), "qq-message-dedupe.json");
}

function emptyState(): DedupeState {
  return { version: 1, contacts: {} };
}

function normalizeMessageId(messageId: number | string | undefined | null): string {
  return String(messageId ?? "").trim();
}

async function loadState(): Promise<DedupeState> {
  if (cachedState) return cachedState;

  try {
    const raw = await fs.readFile(statePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<DedupeState>;
    cachedState = {
      version: 1,
      contacts: parsed.contacts && typeof parsed.contacts === "object" ? parsed.contacts : {},
    };
  } catch {
    cachedState = emptyState();
  }

  return cachedState;
}

async function saveState(state: DedupeState): Promise<void> {
  const file = statePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function hasSeenQqMessage(contactId: string, messageId: number | string | undefined | null): Promise<boolean> {
  const normalized = normalizeMessageId(messageId);
  if (!normalized) return false;
  const state = await loadState();
  return state.contacts[contactId]?.seenMessageIds.includes(normalized) ?? false;
}

export async function countSeenQqMessages(contactId: string): Promise<number> {
  const state = await loadState();
  return state.contacts[contactId]?.seenMessageIds.length ?? 0;
}

export async function markQqMessageSeen(contactId: string, messageId: number | string | undefined | null): Promise<void> {
  const normalized = normalizeMessageId(messageId);
  if (!normalized) return;

  const state = await loadState();
  const existing = state.contacts[contactId] ?? { seenMessageIds: [] };
  const nextIds = existing.seenMessageIds.filter(id => id !== normalized);
  nextIds.push(normalized);
  existing.seenMessageIds = nextIds.slice(-MAX_SEEN_IDS_PER_CONTACT);
  existing.updatedAt = new Date().toISOString();
  state.contacts[contactId] = existing;

  writeChain = writeChain
    .catch(() => undefined)
    .then(() => saveState(state));
  await writeChain;
}
