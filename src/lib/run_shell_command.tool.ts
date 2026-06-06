import { BaseTerminalTabComponent } from "tabby-terminal";
import {
  TerminalBufferPosition,
  TerminalContextService,
} from "../services/terminal_context.service";
import { Tool, ToolArgDefinition, ToolExecutionContext } from "./tool_types";

interface RunShellCommandArgs {
  command: string;
  risk_level: string;
  explanation: string;
  estimated_run_time: number;
}

export class RunShellCommandTool implements Tool {
  constructor(
    private terminal: BaseTerminalTabComponent<any>,
    private terminalContext: TerminalContextService,
  ) {}

  name(): string {
    return "run_shell_command";
  }

  description(): string {
    return [
      "Requests execution of a shell command in the current terminal tab.",
      "Always include the exact command, a short risk_level, a user-facing explanation, and an estimated_run_time in seconds.",
    ].join(" ");
  }

  arguments(): ToolArgDefinition[] {
    return [
      {
        name: "command",
        type: "string",
        description: "Exact shell command to send to the active terminal.",
        required: true,
      },
      {
        name: "risk_level",
        type: "string",
        description: "Short risk label such as low, medium, or high.",
        required: true,
      },
      {
        name: "explanation",
        type: "string",
        description: "Short explanation of what the command does and why it is needed.",
        required: true,
      },
      {
        name: "estimated_run_time",
        type: "number",
        description:
          "Required initial wait in seconds before polling terminal output for stability.",
        required: true,
      },
    ];
  }

  async exec(
    args: RunShellCommandArgs,
    context?: ToolExecutionContext,
  ): Promise<string> {
    const frontend = this.terminal.frontend;
    if (!frontend) {
      throw new Error("Terminal frontend is not ready.");
    }
    this.throwIfAborted(context?.signal);

    const startPosition =
      this.terminalContext.captureBufferPosition(frontend) ??
      this.captureFallbackPosition();

    this.terminal.sendInput(`${args.command}\r`);

    const output = await this.waitForStableTerminalOutput(
      startPosition,
      args.estimated_run_time,
      context?.signal,
    );
    return output || "No terminal output captured.";
  }

  async execSimulated(args: RunShellCommandArgs): Promise<string> {
    return `Simulated terminal output for: ${args.command}`;
  }

  private captureFallbackPosition(): TerminalBufferPosition | null {
    const frontend = this.terminal.frontend;
    if (!frontend) {
      return null;
    }

    const context = this.terminalContext.getLastNLines(frontend, 1);
    if (!context?.cursorPosition) {
      return null;
    }

    return {
      row: context.cursorPosition.row,
    };
  }

  private async waitForStableTerminalOutput(
    startPosition: TerminalBufferPosition | null,
    waitTimeSeconds?: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const frontend = this.terminal.frontend;
    if (!frontend) {
      return "";
    }

    const initialWaitMs = this.normalizeWaitTime(waitTimeSeconds);
    let lastOutput = "";

    await this.sleep(initialWaitMs, signal);
    lastOutput = this.getCommandOutput(startPosition);

    while (true) {
      await this.sleep(1000, signal);
      const output = this.getCommandOutput(startPosition);
      if (output !== lastOutput) {
        lastOutput = output;
        continue;
      }

      return output;
    }
  }

  private normalizeWaitTime(waitTimeSeconds?: number): number {
    if (
      typeof waitTimeSeconds !== "number" ||
      !Number.isFinite(waitTimeSeconds) ||
      waitTimeSeconds < 0
    ) {
      return 700;
    }

    return waitTimeSeconds * 1000;
  }

  private getCommandOutput(
    startPosition: TerminalBufferPosition | null,
  ): string {
    const frontend = this.terminal.frontend;
    if (!frontend) {
      return "";
    }

    const context = startPosition
      ? this.terminalContext.getContentSince(frontend, startPosition, 500)
      : this.terminalContext.getLastCommandContext(frontend, 200);

    return context?.content?.trim() || "";
  }

  private sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
    this.throwIfAborted(signal);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      const onAbort = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        reject(new DOMException("Operation was aborted.", "AbortError"));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException("Operation was aborted.", "AbortError");
    }
  }
}
