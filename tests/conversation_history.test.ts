import assert from "node:assert/strict";
import {
  ConversationHistoryStore,
  type StoredConversation,
  createConversationTitle,
  sanitizeHistoryForResume,
} from "../src/lib/conversation_history.ts";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function conversation(id: string, updatedAt: string): StoredConversation {
  return {
    id,
    title: `Conversation ${id}`,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt,
    messages: [
      {
        id: `message-${id}`,
        role: "user" as const,
        content: id,
        streaming: false,
      },
    ],
    toolCalls: [],
    llmHistory: [{ role: "user" as const, content: id }],
  };
}

const storage = new MemoryStorage();
const store = new ConversationHistoryStore(storage, 2);
assert.equal(store.save(conversation("one", "2026-08-03T01:00:00.000Z")), true);
assert.equal(store.save(conversation("two", "2026-08-03T02:00:00.000Z")), true);
assert.equal(store.save(conversation("three", "2026-08-03T03:00:00.000Z")), true);
assert.deepEqual(
  store.list().map((item) => item.id),
  ["three", "two"],
);

store.delete("three");
assert.deepEqual(
  store.list().map((item) => item.id),
  ["two"],
);

const withCollapsedOutput = conversation(
  "collapsed",
  "2026-08-03T04:00:00.000Z",
);
withCollapsedOutput.toolCalls = [
  {
    id: "tool-collapsed",
    name: "run_shell_command",
    args: { command: "pwd" },
    status: "completed",
    output: "/workspace",
    errorMessage: null,
    command: "pwd",
    riskLevel: "low",
    explanation: "Show the current directory.",
    estimatedRunTime: "1 s",
    question: null,
    choices: [],
    outputCollapsed: false,
  },
];
assert.equal(store.save(withCollapsedOutput), true);
assert.equal(store.get("collapsed")?.toolCalls[0].outputCollapsed, false);

assert.equal(createConversationTitle("  inspect\n  the logs  "), "inspect the logs");
assert.equal(createConversationTitle("x".repeat(50)), `${"x".repeat(42)}...`);

const completedHistory = sanitizeHistoryForResume([
  { role: "system", content: "old system prompt" },
  { role: "user", content: "check both" },
  {
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "a", type: "function", function: { name: "one", arguments: "{}" } },
      { id: "b", type: "function", function: { name: "two", arguments: "{}" } },
    ],
  },
  { role: "tool", content: "one done", tool_call_id: "a" },
  { role: "tool", content: "two done", tool_call_id: "b" },
  { role: "reasoning", content: "private reasoning" },
  { role: "assistant", content: "both complete" },
]);
assert.deepEqual(
  completedHistory.map((item) => item.role),
  ["user", "assistant", "tool", "tool", "assistant"],
);

const interruptedHistory = sanitizeHistoryForResume([
  { role: "user", content: "check both" },
  {
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "a", type: "function", function: { name: "one", arguments: "{}" } },
      { id: "b", type: "function", function: { name: "two", arguments: "{}" } },
    ],
  },
  { role: "tool", content: "one done", tool_call_id: "a" },
]);
assert.deepEqual(interruptedHistory, [{ role: "user", content: "check both" }]);

const duplicateToolHistory = sanitizeHistoryForResume([
  { role: "user", content: "run once" },
  {
    role: "assistant",
    content: null,
    tool_calls: [
      { id: "only", type: "function", function: { name: "once", arguments: "{}" } },
    ],
  },
  { role: "tool", content: "first", tool_call_id: "only" },
  { role: "tool", content: "duplicate", tool_call_id: "only" },
]);
assert.deepEqual(duplicateToolHistory, [{ role: "user", content: "run once" }]);

console.log("conversation_history tests passed");
