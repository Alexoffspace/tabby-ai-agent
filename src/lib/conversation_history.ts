import type { LLMHistoryItem } from "./llm_chat_session";

export type StoredChatRole = "user" | "assistant" | "reasoning" | "tool";

export interface StoredChatMessage {
  id: string;
  role: StoredChatRole;
  content: string;
  streaming: boolean;
  collapsed?: boolean;
  toolCallIds?: string[];
  toolCallId?: string | null;
}

export interface StoredToolCall {
  id: string;
  name: string;
  args: any;
  status: string;
  output: string | null;
  errorMessage: string | null;
  command: string | null;
  riskLevel: string | null;
  explanation: string | null;
  estimatedRunTime: string | null;
  question: string | null;
  choices: string[];
  outputCollapsed?: boolean;
}

export interface StoredConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredChatMessage[];
  toolCalls: StoredToolCall[];
  llmHistory: LLMHistoryItem[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "tabby-ai-agent.conversations.v1";
const DEFAULT_MAX_CONVERSATIONS = 30;

export class ConversationHistoryStore {
  private storage: StorageLike | null;
  private maxConversations: number;

  constructor(
    storage: StorageLike | null = getBrowserStorage(),
    maxConversations = DEFAULT_MAX_CONVERSATIONS,
  ) {
    this.storage = storage;
    this.maxConversations = maxConversations;
  }

  list(): StoredConversation[] {
    if (!this.storage) {
      return [];
    }

    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const value = JSON.parse(raw);
      if (!Array.isArray(value)) {
        return [];
      }

      return value
        .filter(isStoredConversation)
        .sort(
          (left, right) =>
            Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
        );
    } catch {
      return [];
    }
  }

  get(id: string): StoredConversation | null {
    const conversation = this.list().find((item) => item.id === id);
    return conversation ? clone(conversation) : null;
  }

  save(conversation: StoredConversation): boolean {
    if (!this.storage) {
      return false;
    }

    const conversations = this.list().filter(
      (item) => item.id !== conversation.id,
    );
    conversations.unshift(clone(conversation));

    const retained = conversations.slice(0, this.maxConversations);
    while (retained.length > 0) {
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(retained));
        return true;
      } catch {
        retained.pop();
      }
    }

    return false;
  }

  delete(id: string): void {
    if (!this.storage) {
      return;
    }

    const retained = this.list().filter((item) => item.id !== id);
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(retained));
    } catch {
      // Keep the existing history if the host storage is temporarily unavailable.
    }
  }
}

export function createConversationTitle(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= 42) {
    return normalized || "New conversation";
  }
  return `${normalized.slice(0, 42).trimEnd()}...`;
}

export function sanitizeHistoryForResume(
  history: LLMHistoryItem[],
): LLMHistoryItem[] {
  const input = clone(history).filter(
    (item) => item.role !== "system" && item.role !== "reasoning",
  );
  const result: LLMHistoryItem[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    if (item.role === "tool") {
      continue;
    }

    const toolCalls = item.role === "assistant" ? item.tool_calls ?? [] : [];
    if (!toolCalls.length) {
      result.push(item);
      continue;
    }

    const expectedToolIds = new Set(toolCalls.map((toolCall) => toolCall.id));
    const toolResults: LLMHistoryItem[] = [];
    let cursor = index + 1;
    while (cursor < input.length && input[cursor].role === "tool") {
      const toolResult = input[cursor];
      if (
        toolResult.tool_call_id &&
        expectedToolIds.has(toolResult.tool_call_id)
      ) {
        toolResults.push(toolResult);
      }
      cursor += 1;
    }

    const completedIds = new Set(
      toolResults.map((toolResult) => toolResult.tool_call_id),
    );
    if (
      toolResults.length !== expectedToolIds.size ||
      completedIds.size !== expectedToolIds.size ||
      [...expectedToolIds].some((id) => !completedIds.has(id))
    ) {
      break;
    }

    result.push(item, ...toolResults);
    index = cursor - 1;
  }

  return result;
}

function isStoredConversation(value: any): value is StoredConversation {
  return (
    value &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.messages) &&
    Array.isArray(value.toolCalls) &&
    Array.isArray(value.llmHistory)
  );
}

function getBrowserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
