import { BaseTerminalTabComponent } from "tabby-terminal";
import { Tool, ToolArgDefinition } from "./tool_types";

export class CancelCommandTool implements Tool {
  constructor(private terminal: BaseTerminalTabComponent<any>) {}

  name(): string {
    return "cancel_command";
  }

  description(): string {
    return "Sends Ctrl-C to the active terminal to cancel the currently running foreground command.";
  }

  arguments(): ToolArgDefinition[] {
    return [];
  }

  async exec(): Promise<string> {
    if (!this.terminal.frontend) {
      throw new Error("Terminal frontend is not ready.");
    }

    this.terminal.sendInput("\x03");
    return "Sent Ctrl-C to the active terminal.";
  }

  async execSimulated(): Promise<string> {
    return "Simulated sending Ctrl-C to the active terminal.";
  }
}
