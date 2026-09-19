import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  EventEmitter,
  Output,
  ViewChild,
  ElementRef,
} from "@angular/core";
import { ConfigService } from "tabby-core";
import { BaseTerminalTabComponent, Frontend } from "tabby-terminal";
import { GetTerminalLinesTool } from "../lib/get_terminal_lines.tool";
import {
  buildSystemPrompt,
  LLMChatSession,
  LLMHistoryItem,
} from "../lib/llm_chat_session";
import { Tool, ToolExecutionState } from "../lib/tool_types";
import { RunShellCommandTool } from "../lib/run_shell_command.tool";
import { CancelCommandTool } from "../lib/cancel_command.tool";
import { TerminalContextService } from "../services/terminal_context.service";
import { AskUserTool } from "../lib/ask_user.tool";
import { ApprovalMode } from "../config";
import {
  ConversationHistoryStore,
  StoredConversation,
  createConversationTitle,
  sanitizeHistoryForResume,
} from "../lib/conversation_history";

type ChatRole = "user" | "assistant" | "reasoning" | "tool";
type ToolCallStatus =
  | "awaiting_approval"
  | "awaiting_user_input"
  | "awaiting_terminal_input"
  | "executing"
  | "blocked"
  | "completed"
  | "error";

interface ToolCallViewModel {
  id: string;
  name: string;
  args: any;
  status: ToolCallStatus;
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

interface PendingUserInputRequest {
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  settled: boolean;
  draftAnswer: string;
  abortHandler?: () => void;
}

interface ChatMessageViewModel {
  id: string;
  role: ChatRole;
  content: string;
  streaming: boolean;
  collapsed?: boolean;
  toolCallIds?: string[];
  toolCallId?: string | null;
}

@Component({
  selector: "ai-agent-panel",
  templateUrl: "./agent_panel.html",
  styleUrls: ["./agent_panel.scss"],
})
export class AIPanelComponent implements OnInit, OnDestroy {
  @Input() frontend: Frontend | undefined;
  @Input() terminal: BaseTerminalTabComponent<any> | undefined;
  @Output() closed = new EventEmitter<void>();
  @Output() insertCommand = new EventEmitter<string>();
  @Output() executeCommand = new EventEmitter<string>();
  @ViewChild("messagesContainer")
  messagesContainer?: ElementRef<HTMLElement>;
  @ViewChild("promptInput")
  promptInput?: ElementRef<HTMLTextAreaElement>;
  @ViewChild("askUserInput")
  askUserInput?: ElementRef<HTMLInputElement>;

  private userIsNearBottom = true;

  draftPrompt = "";
  messages: ChatMessageViewModel[] = [];
  toolCalls: ToolCallViewModel[] = [];
  sending = false;
  lastError: string | null = null;
  historyOpen = false;
  conversations: StoredConversation[] = [];
  activeConversationId = this.generateId("conversation");
  activeConversationTitle = "New conversation";

  private chatSession: LLMChatSession | null = null;
  private activeLLMHistory: LLMHistoryItem[] = [];
  private conversationCreatedAt = new Date().toISOString();
  private readonly historyStore = new ConversationHistoryStore();
  private currentAbortController: AbortController | null = null;
  private streamingAssistantMessageId: string | null = null;
  private streamingReasoningMessageId: string | null = null;
  private sessionTools: Tool[] = [];
  private pendingToolApprovals = new Map<
    string,
    {
      resolve: (approved: boolean) => void;
      settled: boolean;
    }
  >();
  private pendingUserInputs = new Map<string, PendingUserInputRequest>();

  constructor(
    private config: ConfigService,
    private terminalContext: TerminalContextService,
  ) {}

  ngOnInit(): void {
    this.config.store.aiAgent ??= {};
    this.config.store.aiAgent.llmEndpoint ??= "";
    this.config.store.aiAgent.apiToken ??= "";
    this.config.store.aiAgent.model ??= "default";
    if (
      this.config.store.aiAgent.autoApproveLowRiskCommands === true &&
      (!this.config.store.aiAgent.approvalMode ||
        this.config.store.aiAgent.approvalMode === "manual")
    ) {
      this.config.store.aiAgent.approvalMode = "lowRisk";
    } else {
      this.config.store.aiAgent.approvalMode ??= "manual";
    }
    this.config.store.aiAgent.autoApproveLowRiskCommands ??= false;
    this.config.store.aiAgent.additionalRequestParametersText ??= "";
    this.config.store.aiAgent.additionalRequestParameters ??= {};
    this.config.store.aiAgent.additionalSystemPrompt ??= "";
    this.config.store.aiAgent.hideTerminalOutput ??= false;
    this.refreshConversations();
    this.initializeSession();
  }

  ngOnDestroy(): void {
    this.currentAbortController?.abort();
    this.cancelPendingApprovals();
    this.cancelPendingUserInputs();
    this.persistCurrentConversation();
    this.chatSession = null;
  }

  get endpointConfigured(): boolean {
    return Boolean(this.getEndpoint());
  }

  get canSend(): boolean {
    return (
      this.endpointConfigured &&
      Boolean(this.terminal) &&
      !this.sending &&
      this.draftPrompt.trim().length > 0
    );
  }

  get approvalMode(): ApprovalMode {
    const configured = this.config.store.aiAgent?.approvalMode;
    if (configured === "all" || configured === "lowRisk") {
      return configured;
    }
    return this.config.store.aiAgent?.autoApproveLowRiskCommands
      ? "lowRisk"
      : "manual";
  }

  get approvalModeLabel(): string {
    switch (this.approvalMode) {
      case "all":
        return "Auto: all commands";
      case "lowRisk":
        return "Auto: low risk";
      case "manual":
        return "Manual approval";
    }
  }

  async sendMessage(): Promise<void> {
    const prompt = this.draftPrompt.trim();
    if (!prompt || this.sending) {
      return;
    }

    if (!this.endpointConfigured) {
      this.lastError =
        "Set an LLM endpoint in plugin settings before starting a chat.";
      return;
    }

    if (!this.terminal) {
      this.lastError =
        "No active terminal tab is available for tool execution.";
      return;
    }

    if (!this.chatSession) {
      this.initializeSession();
    }

    if (!this.chatSession) {
      this.lastError = "Failed to initialize the chat session.";
      return;
    }

    this.lastError = null;
    this.sending = true;
    this.currentAbortController = new AbortController();
    this.draftPrompt = "";
    this.resetTextareaHeight();
    this.clearStreamingDrafts();
    if (this.messages.length === 0) {
      this.activeConversationTitle = createConversationTitle(prompt);
      this.conversationCreatedAt = new Date().toISOString();
    }
    this.appendMessage({
      id: this.generateId("user"),
      role: "user",
      content: prompt,
      streaming: false,
    });

    try {
      await this.chatSession.chat({
        userMessage: prompt,
        silent: true,
        onToken: async (token) => {
          this.appendStreamingToken("assistant", token);
        },
        onReasoningToken: async (token) => {
          this.appendStreamingToken("reasoning", token);
        },
        onPushHistory: async (message) => {
          this.commitHistoryMessage(message);
          this.persistCurrentConversation();
        },
        onToolCall: async (toolCallId, toolName, args) => {
          const needsApproval = toolName === "run_shell_command";
          const needsUserInput = toolName === "ask_user";
          const autoApproved =
            needsApproval && this.shouldAutoApproveCommand(args);
          this.upsertToolCall(
            this.toToolCallViewModel(toolCallId, toolName, args, {
              status: needsUserInput
                ? "awaiting_user_input"
                : needsApproval
                ? autoApproved
                  ? "executing"
                  : "awaiting_approval"
                : "executing",
              output: needsUserInput
                ? "Waiting for user input in the agent panel."
                : needsApproval
                ? autoApproved
                  ? this.getAutoApprovalOutput()
                  : null
                : "Executing tool...",
              errorMessage: null,
            }),
          );

          if (!needsApproval) {
            return true;
          }

          if (autoApproved) {
            return true;
          }

          return await new Promise<boolean>((resolve) => {
            this.pendingToolApprovals.set(toolCallId, {
              resolve,
              settled: false,
            });
          });
        },
        onToolResult: async (toolCallId, toolName, args, output) => {
          const existingToolCall = this.toolCalls.find(
            (item) => item.id === toolCallId,
          );
          const executionState = this.getToolExecutionState(output);

          if (existingToolCall && executionState) {
            this.upsertToolCall({
              ...existingToolCall,
              status: executionState.status,
              output: executionState.output ?? null,
              errorMessage: null,
            });
            return;
          }

          this.upsertToolCall(
            this.toToolCallViewModel(toolCallId, toolName, args, {
              status: output.includes("not allowed") ? "blocked" : "completed",
              output,
              errorMessage: null,
            }),
          );
        },
        onToolError: async (
          toolCallId,
          _details,
          toolName,
          args,
          errorMessage,
        ) => {
          this.upsertToolCall(
            this.toToolCallViewModel(toolCallId, toolName, args, {
              status: "error",
              output: null,
              errorMessage,
            }),
          );
        },
        signal: this.currentAbortController.signal,
      });
    } catch (error) {
      if (this.isAbortError(error)) {
        this.finalizeStreamingDrafts();
        this.markActiveToolCallsStopped();
      } else {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.clearStreamingDrafts();
      }
    } finally {
      this.currentAbortController = null;
      this.sending = false;
      this.persistCurrentConversation();
      this.focusPrompt();
    }
  }

  stopCurrentResponse(): void {
    if (!this.sending) {
      return;
    }

    this.cancelPendingApprovals();
    if (this.hasExecutingShellCommand()) {
      this.terminal?.sendInput("\x03");
    }
    this.currentAbortController?.abort();
    this.finalizeStreamingDrafts();
    this.markActiveToolCallsStopped();
    this.cancelPendingUserInputs();
  }

  handleComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void this.sendMessage();
    }
  }

  handleContainerKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    for (const [hotkeyId, handler] of Object.entries(this.hotkeyHandlers)) {
      const keystrokes = (this.config.store as any).hotkeys?.[hotkeyId] as string[] | undefined;
      if (keystrokes?.length && keystrokes.some(k => this.matchKeystroke(k, event))) {
        event.preventDefault();
        handler();
        return;
      }
    }
  }

  private hotkeyHandlers: Record<string, () => void> = {
    'toggle-ai-agent-panel': () => this.closed.emit(),
    'approve-ai-agent-command': () => this.approveLastPendingCommand(),
    'decline-ai-agent-command': () => this.declineLastPendingCommand(),
    'stop-ai-agent-response': () => this.stopCurrentResponse(),
    'clear-ai-agent-chat': () => this.clearChat(),
  };

  private matchKeystroke(keystroke: string, event: KeyboardEvent): boolean {
    const parts = keystroke.split('-');
    if (parts.length < 2) return false;
    const key = parts.pop()!.toLowerCase();
    const hasCtrl = parts.includes('Ctrl');
    const hasMeta = parts.some(p => ['⌘', 'Win', 'Super', 'Meta'].includes(p));
    const hasAlt = parts.some(p => ['⌥', 'Alt'].includes(p));
    const hasShift = parts.includes('Shift');
    const eventKey = event.key?.toLowerCase();
    const codeKey = event.code?.replace(/^(Key|Digit|Arrow)/, '').toLowerCase();
    return (
      event.ctrlKey === hasCtrl &&
      event.altKey === hasAlt &&
      event.metaKey === hasMeta &&
      event.shiftKey === hasShift &&
      (eventKey === key || codeKey === key)
    );
  }

  autoResizeTextarea(): void {
    const textarea = this.promptInput?.nativeElement;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  }

  toggleHistory(): void {
    if (!this.historyOpen) {
      this.refreshConversations();
    }
    this.historyOpen = !this.historyOpen;
  }

  startNewConversation(): void {
    if (this.sending) {
      this.currentAbortController?.abort();
      this.finalizeStreamingDrafts();
      this.markActiveToolCallsStopped();
    }

    this.persistCurrentConversation();
    this.resetConversationState();
    this.historyOpen = false;
    this.userIsNearBottom = true;
    this.initializeSession();
    this.scrollMessagesToBottom();
    this.focusPrompt();
  }

  clearChat(): void {
    this.startNewConversation();
  }

  resumeConversation(conversationId: string): void {
    if (this.sending) {
      return;
    }

    const conversation = this.historyStore.get(conversationId);
    if (!conversation) {
      this.lastError = "That saved conversation is no longer available.";
      this.refreshConversations();
      return;
    }

    this.persistCurrentConversation();
    this.cancelPendingApprovals();
    this.cancelPendingUserInputs();
    this.clearStreamingDrafts();

    this.activeConversationId = conversation.id;
    this.activeConversationTitle = conversation.title;
    this.conversationCreatedAt = conversation.createdAt;
    this.messages = conversation.messages.map((message) => ({
      ...message,
      streaming: false,
    }));
    this.toolCalls = conversation.toolCalls.map((toolCall) =>
      this.restoreToolCall(toolCall),
    );
    this.lastError = null;
    this.draftPrompt = "";
    this.historyOpen = false;
    this.userIsNearBottom = true;
    this.initializeSession(sanitizeHistoryForResume(conversation.llmHistory));
    this.scrollMessagesToBottom();
    this.focusPrompt();
  }

  deleteConversation(conversationId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.historyStore.delete(conversationId);
    if (conversationId === this.activeConversationId) {
      this.resetConversationState();
      this.initializeSession();
    }
    this.refreshConversations();
  }

  trackConversation(
    _index: number,
    conversation: StoredConversation,
  ): string {
    return conversation.id;
  }

  formatConversationTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private resetConversationState(): void {
    this.messages = [];
    this.toolCalls = [];
    this.lastError = null;
    this.draftPrompt = "";
    this.streamingAssistantMessageId = null;
    this.streamingReasoningMessageId = null;
    this.cancelPendingApprovals();
    this.cancelPendingUserInputs();
    this.activeConversationId = this.generateId("conversation");
    this.activeConversationTitle = "New conversation";
    this.conversationCreatedAt = new Date().toISOString();
  }

  approveToolCall(toolCallId: string): void {
    const approval = this.pendingToolApprovals.get(toolCallId);
    if (!approval || approval.settled) {
      return;
    }

    approval.settled = true;
    this.upsertToolCall({
      ...this.mustGetToolCall(toolCallId),
      status: "executing",
      output: "Command approved. Sending to terminal...",
      errorMessage: null,
    });
    approval.resolve(true);
    this.pendingToolApprovals.delete(toolCallId);
  }

  declineToolCall(toolCallId: string): void {
    const approval = this.pendingToolApprovals.get(toolCallId);
    if (!approval || approval.settled) {
      return;
    }

    approval.settled = true;
    this.upsertToolCall({
      ...this.mustGetToolCall(toolCallId),
      status: "blocked",
      output: "Command was declined by the user.",
      errorMessage: null,
    });
    approval.resolve(false);
    this.pendingToolApprovals.delete(toolCallId);
  }

  approveLastPendingCommand(): void {
    const pending = this.toolCalls.find(
      (tc) => tc.status === "awaiting_approval",
    );
    if (pending) {
      this.approveToolCall(pending.id);
    }
  }

  declineLastPendingCommand(): void {
    const pending = this.toolCalls.find(
      (tc) => tc.status === "awaiting_approval",
    );
    if (pending) {
      this.declineToolCall(pending.id);
    }
  }

  submitUserAnswer(toolCallId: string, answer?: string): void {
    const request = this.pendingUserInputs.get(toolCallId);
    if (!request || request.settled) {
      return;
    }

    const toolCall = this.mustGetToolCall(toolCallId);
    const rawAnswer = answer ?? request.draftAnswer;
    const trimmedAnswer = rawAnswer.trim();

    if (!trimmedAnswer) {
      return;
    }

    this.upsertToolCall({
      ...toolCall,
      status: "executing",
      output: `User answered: ${trimmedAnswer}`,
      errorMessage: null,
    });
    request.resolve(trimmedAnswer);
  }

  updatePendingUserAnswer(toolCallId: string, value: string): void {
    const request = this.pendingUserInputs.get(toolCallId);
    if (!request || request.settled) {
      return;
    }

    request.draftAnswer = value;
  }

  getPendingUserAnswer(toolCallId: string): string {
    return this.pendingUserInputs.get(toolCallId)?.draftAnswer ?? "";
  }

  trackMessage(_index: number, message: ChatMessageViewModel): string {
    return message.id;
  }

  trackToolCall(_index: number, toolCall: ToolCallViewModel): string {
    return toolCall.id;
  }

  toggleMessageCollapsed(messageId: string): void {
    this.messages = this.messages.map((message) =>
      message.id === messageId
        ? { ...message, collapsed: !message.collapsed }
        : message,
    );
    this.persistCurrentConversation();
  }

  toggleToolCallOutputCollapsed(toolCallId: string): void {
    this.toolCalls = this.toolCalls.map((tc) =>
      tc.id === toolCallId
        ? { ...tc, outputCollapsed: !tc.outputCollapsed }
        : tc,
    );
    this.persistCurrentConversation();
  }

  getHotkeyLabel(hotkeyId: string): string {
    const keys = this.config.store.hotkeys?.[hotkeyId];
    return keys?.length ? keys[0].replace(/-/g, '+') : '';
  }

  formatToolArgs(args: any): string {
    try {
      return JSON.stringify(args ?? {}, null, 2);
    } catch {
      return String(args);
    }
  }

  getToolCalls(toolCallIds?: string[]): ToolCallViewModel[] {
    if (!toolCallIds?.length) {
      return [];
    }

    return toolCallIds
      .map((id) => this.toolCalls.find((toolCall) => toolCall.id === id))
      .filter((toolCall): toolCall is ToolCallViewModel => Boolean(toolCall));
  }

  private initializeSession(history: LLMHistoryItem[] = []): void {
    this.activeLLMHistory = history;
    const endpoint = this.getEndpoint();
    if (!endpoint || !this.terminal || !this.frontend) {
      this.chatSession = null;
      this.sessionTools = [];
      return;
    }

    this.sessionTools = [
      new GetTerminalLinesTool(this.frontend, this.terminalContext),
      new RunShellCommandTool(this.terminal, this.terminalContext),
      new CancelCommandTool(this.terminal),
      new AskUserTool((toolCallId, args, signal) =>
        this.requestUserAnswer(toolCallId, args, signal),
      ),
    ];

    this.chatSession = new LLMChatSession(
      endpoint,
      buildSystemPrompt(this.getAdditionalSystemPrompt()),
      this.sessionTools,
      this.getApiToken(),
      this.getModel(),
      this.getAdditionalRequestParameters(),
      history,
    );
  }

  private getEndpoint(): string {
    return this.config.store.aiAgent?.llmEndpoint?.trim?.() ?? "";
  }

  private shouldAutoApproveCommand(args: any): boolean {
    return (
      this.approvalMode === "all" ||
      (this.approvalMode === "lowRisk" &&
        this.getNormalizedRiskLevel(args) === "low")
    );
  }

  private getAutoApprovalOutput(): string {
    return this.approvalMode === "all"
      ? "Auto-approved command. Sending to terminal..."
      : "Auto-approved low-risk command. Sending to terminal...";
  }

  private getAdditionalRequestParameters(): Record<string, any> {
    const params = this.config.store.aiAgent?.additionalRequestParameters;
    return this.isPlainObject(params) ? params : {};
  }

  private getApiToken(): string {
    return this.config.store.aiAgent?.apiToken?.trim?.() ?? "";
  }

  private getModel(): string {
    return this.config.store.aiAgent?.model?.trim?.() || "default";
  }

  private getAdditionalSystemPrompt(): string {
    return this.config.store.aiAgent?.additionalSystemPrompt?.trim?.() ?? "";
  }

  private refreshConversations(): void {
    this.conversations = this.historyStore.list();
  }

  private persistCurrentConversation(): void {
    if (this.messages.length === 0) {
      return;
    }

    const sessionHistory = this.chatSession?.getHistory();
    if (sessionHistory) {
      this.activeLLMHistory = sessionHistory;
    }

    this.historyStore.save({
      id: this.activeConversationId,
      title: this.activeConversationTitle,
      createdAt: this.conversationCreatedAt,
      updatedAt: new Date().toISOString(),
      messages: this.messages.map((message) => ({
        ...message,
        streaming: false,
      })),
      toolCalls: this.toolCalls,
      llmHistory: this.activeLLMHistory,
    });
    this.refreshConversations();
  }

  private restoreToolCall(
    toolCall: StoredConversation["toolCalls"][number],
  ): ToolCallViewModel {
    const interrupted =
      toolCall.status === "awaiting_approval" ||
      toolCall.status === "awaiting_user_input" ||
      toolCall.status === "awaiting_terminal_input" ||
      toolCall.status === "executing";
    const status = this.isToolCallStatus(toolCall.status)
      ? interrupted
        ? "blocked"
        : toolCall.status
      : "error";

    return {
      ...toolCall,
      status,
      output: interrupted
        ? toolCall.output
          ? `${toolCall.output}\nInterrupted before this conversation was resumed.`
          : "Interrupted before this conversation was resumed."
        : toolCall.output,
      errorMessage: this.isToolCallStatus(toolCall.status)
        ? toolCall.errorMessage
        : "The saved tool status was invalid.",
    };
  }

  private isToolCallStatus(value: string): value is ToolCallStatus {
    return [
      "awaiting_approval",
      "awaiting_user_input",
      "awaiting_terminal_input",
      "executing",
      "blocked",
      "completed",
      "error",
    ].includes(value);
  }

  private appendStreamingToken(
    role: "assistant" | "reasoning",
    token: string,
  ): void {
    const messageIdField =
      role === "assistant"
        ? "streamingAssistantMessageId"
        : "streamingReasoningMessageId";

    let messageId = this[messageIdField];
    if (!messageId) {
      messageId = this.generateId(role);
      this[messageIdField] = messageId;
      this.messages = [
        ...this.messages,
        {
          id: messageId,
          role,
          content: token,
          streaming: true,
          collapsed: role === "reasoning",
        },
      ];
    } else {
      this.messages = this.messages.map((message) =>
        message.id === messageId
          ? { ...message, content: `${message.content}${token}` }
          : message,
      );
    }

    this.scrollMessagesToBottom();
  }

  private commitHistoryMessage(message: LLMHistoryItem): void {
    if (message.role === "system" || message.role === "user") {
      return;
    }

    if (message.role === "assistant") {
      this.finalizeStreamingMessage(
        "assistant",
        this.historyContentToText(message.content),
        {
          toolCallIds: message.tool_calls?.map((toolCall) => toolCall.id) ?? [],
        },
      );
      return;
    }

    if (message.role === "reasoning") {
      this.finalizeStreamingMessage(
        "reasoning",
        this.historyContentToText(message.content),
      );
      return;
    }

    if (message.role === "tool") {
      const toolCallId = message.tool_call_id ?? null;
      if (toolCallId) {
        const existingToolCall = this.toolCalls.find(
          (item) => item.id === toolCallId,
        );
        if (existingToolCall) {
          this.upsertToolCall({
            ...existingToolCall,
            output: this.historyContentToText(message.content),
          });
        }
      }
    }
  }

  private finalizeStreamingMessage(
    role: "assistant" | "reasoning",
    content: string,
    extra: Partial<ChatMessageViewModel> = {},
  ): void {
    const messageId =
      role === "assistant"
        ? this.streamingAssistantMessageId
        : this.streamingReasoningMessageId;

    if (messageId) {
      this.messages = this.messages.map((message) =>
        message.id === messageId
          ? { ...message, content, streaming: false, ...extra }
          : message,
      );
    } else {
      this.appendMessage({
        id: this.generateId(role),
        role,
        content,
        streaming: false,
        collapsed: role === "reasoning",
        ...extra,
      });
    }

    if (role === "assistant") {
      this.streamingAssistantMessageId = null;
    } else {
      this.streamingReasoningMessageId = null;
    }
  }

  private appendMessage(message: ChatMessageViewModel): void {
    this.messages = [...this.messages, message];
    this.scrollMessagesToBottom();
  }

  private upsertToolCall(toolCall: ToolCallViewModel): void {
    const existingIndex = this.toolCalls.findIndex(
      (item) => item.id === toolCall.id,
    );
    if (existingIndex === -1) {
      this.toolCalls = [...this.toolCalls, toolCall];
    } else {
      const next = [...this.toolCalls];
      next[existingIndex] = {
        ...next[existingIndex],
        ...toolCall,
      };
      this.toolCalls = next;
    }

    this.scrollMessagesToBottom();
  }

  private toToolCallViewModel(
    id: string,
    name: string,
    args: any,
    state: Pick<ToolCallViewModel, "status" | "output" | "errorMessage">,
  ): ToolCallViewModel {
    return {
      id,
      name,
      args,
      status: state.status,
      output: state.output,
      errorMessage: state.errorMessage,
      outputCollapsed: true,
      command: this.getToolArg(args, "command"),
      riskLevel: this.getToolArg(args, "risk_level"),
      explanation: this.getToolArg(args, "explanation"),
      estimatedRunTime: this.getNumericToolArg(args, "estimated_run_time"),
      question: this.getToolArg(args, "question"),
      choices: this.getStringArrayToolArg(args, "choices"),
    };
  }

  private mustGetToolCall(toolCallId: string): ToolCallViewModel {
    const toolCall = this.toolCalls.find((item) => item.id === toolCallId);
    if (!toolCall) {
      throw new Error(`Tool call not found: ${toolCallId}`);
    }
    return toolCall;
  }

  private getToolExecutionState(output: string): ToolExecutionState | null {
    if (
      output === "Command approved. Sending to terminal..." ||
      output === "Terminal input received. Waiting for the command to finish..."
    ) {
      return {
        status: "executing",
        output,
      };
    }

    if (
      output ===
      "Waiting for secure input in the terminal. Focus the terminal tab and complete the prompt there."
    ) {
      return {
        status: "awaiting_terminal_input",
        output,
      };
    }

    if (output === "Waiting for user input in the agent panel.") {
      return {
        status: "awaiting_user_input",
        output,
      };
    }

    return null;
  }

  private getToolArg(args: any, key: string): string | null {
    const value = args?.[key];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  }

  private getNormalizedRiskLevel(args: any): string | null {
    return this.getToolArg(args, "risk_level")?.trim().toLowerCase() ?? null;
  }

  private getStringArrayToolArg(args: any, key: string): string[] {
    const value = args?.[key];
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }

  private isPlainObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  get hideTerminalOutput(): boolean {
    return !!this.config.store.aiAgent?.hideTerminalOutput;
  }

  private getNumericToolArg(args: any, key: string): string | null {
    const value = args?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return `${value} s`;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? `${parsed} s` : value.trim();
    }

    return null;
  }

  private historyContentToText(content: LLMHistoryItem["content"]): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }

          if (item?.type === "text") {
            return item.text ?? "";
          }

          if (item?.type === "image_url") {
            return "[image]";
          }

          return JSON.stringify(item);
        })
        .join("\n");
    }

    if (content == null) {
      return "";
    }

    return String(content);
  }

  private clearStreamingDrafts(): void {
    if (this.streamingAssistantMessageId) {
      this.messages = this.messages.filter(
        (message) => message.id !== this.streamingAssistantMessageId,
      );
      this.streamingAssistantMessageId = null;
    }

    if (this.streamingReasoningMessageId) {
      this.messages = this.messages.filter(
        (message) => message.id !== this.streamingReasoningMessageId,
      );
      this.streamingReasoningMessageId = null;
    }
  }

  private finalizeStreamingDrafts(): void {
    if (this.streamingAssistantMessageId) {
      this.messages = this.messages.map((message) =>
        message.id === this.streamingAssistantMessageId
          ? { ...message, streaming: false }
          : message,
      );
      this.streamingAssistantMessageId = null;
    }

    if (this.streamingReasoningMessageId) {
      this.messages = this.messages.map((message) =>
        message.id === this.streamingReasoningMessageId
          ? { ...message, streaming: false }
          : message,
      );
      this.streamingReasoningMessageId = null;
    }
  }

  private markActiveToolCallsStopped(): void {
    this.toolCalls = this.toolCalls.map((toolCall) =>
      toolCall.status === "awaiting_approval" ||
      toolCall.status === "awaiting_user_input" ||
      toolCall.status === "awaiting_terminal_input" ||
      toolCall.status === "executing"
        ? {
            ...toolCall,
            status: "blocked",
            output: toolCall.output
              ? `${toolCall.output}\nStopped by the user.`
              : "Stopped by the user.",
            errorMessage: null,
          }
        : toolCall,
    );
  }

  private hasExecutingShellCommand(): boolean {
    return this.toolCalls.some(
      (toolCall) =>
        toolCall.name === "run_shell_command" &&
        toolCall.status === "executing",
    );
  }

  private isAbortError(error: unknown): boolean {
    return (
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    );
  }

  private cancelPendingApprovals(): void {
    for (const approval of this.pendingToolApprovals.values()) {
      if (!approval.settled) {
        approval.settled = true;
        approval.resolve(false);
      }
    }
    this.pendingToolApprovals.clear();
  }

  private requestUserAnswer(
    toolCallId: string,
    args: { question: string; choices?: string[] },
    signal?: AbortSignal,
  ): Promise<string> {
    const toolCall = this.toolCalls.find((item) => item.id === toolCallId);
    if (
      !toolCall ||
      toolCall.name !== "ask_user" ||
      toolCall.question !== args.question
    ) {
      throw new Error("Unable to present ask_user prompt in the panel.");
    }

    return new Promise<string>((resolve, reject) => {
      const request: PendingUserInputRequest = {
        resolve: (answer) => {
          cleanup();
          resolve(answer);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        settled: false,
        draftAnswer: "",
      };

      const cleanup = () => {
        request.settled = true;
        if (request.abortHandler) {
          signal?.removeEventListener("abort", request.abortHandler);
        }
        this.pendingUserInputs.delete(toolCallId);
      };

      if (signal) {
        request.abortHandler = () => {
          request.reject(new DOMException("Operation was aborted.", "AbortError"));
        };
        signal.addEventListener("abort", request.abortHandler, { once: true });
      }

      this.pendingUserInputs.set(toolCallId, request);
      this.scrollMessagesToBottom();
      setTimeout(() => this.askUserInput?.nativeElement?.focus(), 0);
    });
  }

  private cancelPendingUserInputs(): void {
    for (const request of this.pendingUserInputs.values()) {
      if (!request.settled) {
        request.reject(new DOMException("Operation was aborted.", "AbortError"));
      }
    }
    this.pendingUserInputs.clear();
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private resetTextareaHeight(): void {
    const textarea = this.promptInput?.nativeElement;
    if (textarea) {
      textarea.style.height = "38px";
    }
  }

  public focusPrompt(): void {
    setTimeout(() => this.promptInput?.nativeElement?.focus(), 0);
  }

  public onMessagesScroll(): void {
    const container = this.messagesContainer?.nativeElement;
    if (!container) return;
    const threshold = 80;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    this.userIsNearBottom = distanceFromBottom < threshold;
  }

  private scrollMessagesToBottom(): void {
    if (!this.userIsNearBottom) return;
    setTimeout(() => {
      const container = this.messagesContainer?.nativeElement;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 0);
  }
}
