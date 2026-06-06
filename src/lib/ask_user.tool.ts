import { Tool, ToolArgDefinition, ToolExecutionContext } from "./tool_types";

interface AskUserArgs {
  question: string;
  choices?: string[];
}

export class AskUserTool implements Tool {
  constructor(
    private requestAnswer: (
      toolCallId: string,
      args: AskUserArgs,
      signal?: AbortSignal,
    ) => Promise<string>,
  ) {}

  name(): string {
    return "ask_user";
  }

  description(): string {
    return [
      "Ask the user for missing information in the agent panel.",
      "Use free-text when any answer is acceptable, or provide choices when the user should select one option.",
    ].join(" ");
  }

  arguments(): ToolArgDefinition[] {
    return [
      {
        name: "question",
        type: "string",
        description: "The exact question to present to the user.",
        required: true,
      },
      {
        name: "choices",
        type: "array",
        description:
          "Optional list of selectable answers. Omit this field to collect free-text input instead.",
        required: false,
      },
    ];
  }

  async exec(args: AskUserArgs, context?: ToolExecutionContext): Promise<string> {
    const question = args.question?.trim();
    if (!question) {
      throw new Error("ask_user requires a non-empty question.");
    }

    context?.onStateChange?.({
      status: "awaiting_user_input",
      output: "Waiting for user input in the agent panel.",
    });

    const toolCallId = context?.toolCallId;
    if (!toolCallId) {
      throw new Error("ask_user requires a tool call id.");
    }

    const answer = await this.requestAnswer(
      toolCallId,
      {
        question,
        choices: this.normalizeChoices(args.choices),
      },
      context?.signal,
    );

    return `User answer: ${answer}`;
  }

  async execSimulated(args: AskUserArgs): Promise<string> {
    return `Simulated user answer request: ${args.question}`;
  }

  private normalizeChoices(choices?: string[]): string[] | undefined {
    if (!Array.isArray(choices)) {
      return undefined;
    }

    const normalized = choices
      .map((choice) => (typeof choice === "string" ? choice.trim() : ""))
      .filter((choice) => choice.length > 0);

    return normalized.length ? normalized : undefined;
  }
}
