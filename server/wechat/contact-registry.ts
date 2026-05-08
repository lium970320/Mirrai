export type RecentWeChatContact = {
  id: string;
  name: string;
  lastMessageAt: string;
  lastMessagePreview: string;
};

const MAX_RECENT_CONTACTS = 50;
const recentContacts = new Map<string, RecentWeChatContact>();

function preview(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 80)}...` : normalized;
}

export function recordRecentContact(input: { id: string; name: string; messageText: string }) {
  recentContacts.set(input.id, {
    id: input.id,
    name: input.name || input.id,
    lastMessageAt: new Date().toISOString(),
    lastMessagePreview: preview(input.messageText),
  });

  if (recentContacts.size <= MAX_RECENT_CONTACTS) return;

  const oldest = Array.from(recentContacts.values())
    .sort((a, b) => Date.parse(a.lastMessageAt) - Date.parse(b.lastMessageAt))[0];
  if (oldest) recentContacts.delete(oldest.id);
}

export function listRecentContacts() {
  return Array.from(recentContacts.values())
    .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
}
