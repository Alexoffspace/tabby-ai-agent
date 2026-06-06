import { Frontend } from "tabby-terminal";
import { TerminalContextService } from "../services/terminal_context.service";
import { Tool, ToolArgDefinition } from "./tool_types";

interface GetTerminalLinesArgs {
  lines: number;
}

export class GetTerminalLinesTool implements Tool {
  constructor(
    private frontend: Frontend,
    private terminalContext: TerminalContextService,
  ) {}

  name(): string {
    return "get_terminal_lines";
  }

  description(): string {
    return "Returns the last N lines from the current terminal buffer.";
  }

  arguments(): ToolArgDefinition[] {
    return [
      {
        name: "lines",
        type: "number",
        description: "Number of recent terminal lines to return.",
        required: true,
      },
    ];
  }

  async exec(args: GetTerminalLinesArgs): Promise<string> {
    const requestedLines = Number.isFinite(args.lines) ? Math.floor(args.lines) : 0;
    const lines = Math.max(1, Math.min(500, requestedLines || 50));
    const context = this.terminalContext.getLastNLines(this.frontend, lines);

    if (!context) {
      throw new Error("Terminal frontend is not ready.");
    }

    return context.content || "No terminal content available.";
  }

  async execSimulated(args: GetTerminalLinesArgs): Promise<string> {
    const lines = Math.max(1, Math.min(500, Math.floor(args.lines || 50)));
    return `Simulated terminal snapshot for last ${lines} lines.`;
  }
}
