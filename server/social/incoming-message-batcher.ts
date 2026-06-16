type SocialContactLike = {
  say(text: string): Promise<void> | void;
};

export type BatchedTextMessage = {
  contact: SocialContactLike;
  contactId: string;
  contactName: string;
  messages: string[];
  combinedText: string;
  messageCount: number;
  batchRevision: number;
  isStale: () => boolean;
};

type BatchState = {
  contact: SocialContactLike;
  contactName: string;
  firstMessageAt: number;
  messages: string[];
  processing: boolean;
  timer: NodeJS.Timeout | null;
  revision: number;
};

type EnqueueOptions = {
  contact: SocialContactLike;
  contactId: string;
  contactName: string;
  text: string;
  onBatch: (batch: BatchedTextMessage) => Promise<void>;
};

const DEFAULT_DEBOUNCE_MS = 4_200;
const DEFAULT_MAX_WAIT_MS = 11_000;
const MIN_DEBOUNCE_MS = 1_000;
const MIN_MAX_WAIT_MS = 3_000;

const states = new Map<string, BatchState>();

function readPositiveIntegerEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

function debounceMs(): number {
  return readPositiveIntegerEnv("SOCIAL_REPLY_BATCH_DEBOUNCE_MS", DEFAULT_DEBOUNCE_MS, MIN_DEBOUNCE_MS);
}

function maxWaitMs(): number {
  return readPositiveIntegerEnv("SOCIAL_REPLY_BATCH_MAX_WAIT_MS", DEFAULT_MAX_WAIT_MS, MIN_MAX_WAIT_MS);
}

export function buildBatchedSocialInput(messages: string[]): string {
  const cleanMessages = messages.map(message => message.trim()).filter(Boolean);
  if (cleanMessages.length <= 1) return cleanMessages[0] ?? "";
  return cleanMessages.join("\n");
}

function clearStateTimer(state: BatchState): void {
  if (!state.timer) return;
  clearTimeout(state.timer);
  state.timer = null;
}

function isTextBatchStale(contactId: string, batchRevision: number): boolean {
  const state = states.get(contactId);
  if (!state) return false;
  return state.revision !== batchRevision || state.messages.length > 0;
}

function scheduleFlush(contactId: string, onBatch: (batch: BatchedTextMessage) => Promise<void>): void {
  const state = states.get(contactId);
  if (!state || state.processing) return;

  clearStateTimer(state);
  const elapsed = Date.now() - state.firstMessageAt;
  const remainingMaxWait = Math.max(0, maxWaitMs() - elapsed);
  const delay = Math.min(debounceMs(), remainingMaxWait);

  state.timer = setTimeout(() => {
    void flushTextBatch(contactId, onBatch);
  }, delay);
}

async function flushTextBatch(contactId: string, onBatch: (batch: BatchedTextMessage) => Promise<void>): Promise<void> {
  const state = states.get(contactId);
  if (!state || state.processing || state.messages.length === 0) return;

  clearStateTimer(state);
  const messages = state.messages.splice(0);
  state.processing = true;
  const batchRevision = state.revision;

  const batch: BatchedTextMessage = {
    contact: state.contact,
    contactId,
    contactName: state.contactName,
    messages,
    combinedText: buildBatchedSocialInput(messages),
    messageCount: messages.length,
    batchRevision,
    isStale: () => isTextBatchStale(contactId, batchRevision),
  };

  console.info(
    `[Social] Processing text batch contact=${contactId} messages=${batch.messageCount}`,
  );

  try {
    await onBatch(batch);
  } catch (err) {
    console.error("[Social] Text batch processing failed:", err);
  } finally {
    state.processing = false;
    state.firstMessageAt = Date.now();

    if (state.messages.length > 0) {
      scheduleFlush(contactId, onBatch);
    } else {
      states.delete(contactId);
    }
  }
}

export function enqueueSocialTextMessage(options: EnqueueOptions): void {
  const text = options.text.trim();
  if (!text) return;

  const existing = states.get(options.contactId);
  const state = existing ?? {
    contact: options.contact,
    contactName: options.contactName,
    firstMessageAt: Date.now(),
    messages: [],
    processing: false,
    timer: null,
    revision: 0,
  };

  state.contact = options.contact;
  state.contactName = options.contactName;
  if (state.messages.length === 0) {
    state.firstMessageAt = Date.now();
  }
  state.messages.push(text);
  state.revision += 1;
  states.set(options.contactId, state);

  console.info(
    `[Social] Queued text message contact=${options.contactId} pending=${state.messages.length} processing=${state.processing ? "yes" : "no"}`,
  );

  scheduleFlush(options.contactId, options.onBatch);
}
