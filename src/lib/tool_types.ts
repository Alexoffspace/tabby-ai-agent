export interface ToolArgDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  description: string;
  required: boolean;
}

export interface ToolDefinition<TArgs = any> {
  name: string;
  arguments: ToolArgDefinition[];
  description: string;
  exec: (args: TArgs, context?: ToolExecutionContext) => Promise<string>;
}

export interface ToolExecutionContext {
  signal?: AbortSignal;
}

export interface Tool {
  name(): string;
  description(): string;
  arguments(): ToolArgDefinition[];
  exec(args: any, context?: ToolExecutionContext): Promise<string>;
  execSimulated?(args: any): Promise<string>;
}
