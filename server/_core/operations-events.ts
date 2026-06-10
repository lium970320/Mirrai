export type OperationsEventScope = "voice" | "stickers" | "qq" | "wechat" | "llm" | "database";

export type OperationsEvent = {
  id: string;
  scope: OperationsEventScope;
  title: string;
  detail?: string;
  rawError?: unknown;
  evidence?: string;
  at: string;
};

const MAX_EVENTS = 50;
const events: OperationsEvent[] = [];

function compactId(scope: OperationsEventScope, title: string): string {
  return `${scope}.${title}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function recordOperationsEvent(event: Omit<OperationsEvent, "id" | "at"> & { id?: string; at?: string }) {
  events.unshift({
    ...event,
    id: event.id || compactId(event.scope, event.title),
    at: event.at || new Date().toISOString(),
  });
  events.splice(MAX_EVENTS);
}

export function getRecentOperationsEvents(scope?: OperationsEventScope): OperationsEvent[] {
  return events
    .filter(event => !scope || event.scope === scope)
    .map(event => ({ ...event }));
}

export function clearOperationsEvents() {
  events.length = 0;
}
