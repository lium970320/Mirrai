type ConversationMessage = {
  role: string;
  content: string;
  channel?: string;
  createdAt?: Date | string;
};

function roleLabel(role: string, personaName: string): string {
  return role === "user" ? "用户" : personaName;
}

function timeLabel(value: Date | string | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function compact(content: string, max = 140): string {
  const text = content.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function isQuestionLike(text: string): boolean {
  return /[？?]|吃饭|睡了|睡没|到家|在干嘛|累不累|回不回|怎么不回|课多不多|忙不忙|有没有/.test(text);
}

function lastByRole(messages: ConversationMessage[], role: "user" | "assistant"): ConversationMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === role) return messages[i];
  }
  return undefined;
}

function trailingUsersAfterLastAssistant(messages: ConversationMessage[]): ConversationMessage[] {
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }
  return messages.slice(lastAssistantIndex + 1).filter(message => message.role === "user");
}

export function formatRecentConversationTimeline(
  messages: ConversationMessage[],
  personaName = "王芃泽",
  limit = 10,
): string {
  return messages
    .slice(-limit)
    .map((message) => {
      const time = timeLabel(message.createdAt);
      const prefix = time ? `${time} ` : "";
      const channel = message.channel ? `/${message.channel}` : "";
      return `${prefix}${roleLabel(message.role, personaName)}${channel}：${compact(message.content)}`;
    })
    .join("\n");
}

export function buildConversationContinuityInstruction(
  messages: ConversationMessage[],
  personaName = "王芃泽",
  mode: "reply" | "proactive" = "reply",
): string {
  const recent = messages.slice(-12);
  const timeline = formatRecentConversationTimeline(recent, personaName, 10);
  const last = recent[recent.length - 1];
  const lastAssistant = lastByRole(recent, "assistant");
  const lastUser = lastByRole(recent, "user");
  const unansweredUsers = trailingUsersAfterLastAssistant(recent);
  const lines: string[] = [
    "【对话连续性】",
    "最近聊天是一条连续时间线。先看前文里已经问过、已经说过、用户有没有回答，再决定本轮说什么。",
    "不要把每次回复或主动消息当成全新开场；不要重复刚问过的吃饭、睡觉、到家、忙不忙等问题。",
  ];

  if (mode === "proactive") {
    lines.push("主动发消息时尤其要接住上一条没被回应的话：如果你上一条问过一个具体问题，而用户还没回答，优先自然追问、轻轻抱怨一句或换个角度关心，不要重新问一个相似问题。");
  } else {
    lines.push("用户回消息时，先判断他是在回答前面哪句话；短句、表情、图片都可能是在接上一轮，不要孤立理解。");
  }

  if (mode === "reply" && unansweredUsers.length > 1) {
    lines.push(`从上一条${personaName}回复之后，用户连续发了 ${unansweredUsers.length} 条还没有得到回应。`);
    lines.push("本轮必须把这些未回应消息当作一段连续话语来理解，只生成一次综合回复；不要为每条旧消息分别补答，不要突然连续冒出多条互相割裂的旧回复。");
    lines.push(`未回应用户消息：\n${formatRecentConversationTimeline(unansweredUsers, personaName, 6)}`);
  }

  if (last?.role === "assistant") {
    lines.push(`最近一条是你发出的，用户还没有回应：${compact(last.content, 180)}`);
    if (isQuestionLike(last.content)) {
      lines.push("这条里有疑问或关心点。下一次主动消息不要直接换成另一个无关问题，应先承认对方没回，或沿着同一个关心点轻轻跟进。");
    }
  }

  if (lastAssistant && lastUser && lastUser !== last) {
    lines.push(`最近用户曾说：${compact(lastUser.content, 120)}`);
    lines.push(`你最近曾回：${compact(lastAssistant.content, 120)}`);
  }

  if (timeline) {
    lines.push(`最近对话时间线：\n${timeline}`);
  }

  return lines.join("\n");
}
