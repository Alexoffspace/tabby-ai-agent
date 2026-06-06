import { ConfigProvider, Platform } from "tabby-core";

export type AIProvider = "openrouter" | "litellm";

export interface AIAgentConfig {
  llmEndpoint: string;
  apiToken: string;
  model: string;
  autoApproveLowRiskCommands: boolean;
  additionalRequestParametersText: string;
  additionalRequestParameters: Record<string, any>;
  additionalSystemPrompt: string;
}

export class AIAgentConfigProvider extends ConfigProvider {
  defaults = {
    aiAgent: {
      llmEndpoint: "",
      apiToken: "",
      model: "default",
      autoApproveLowRiskCommands: false,
      additionalRequestParametersText: "",
      additionalRequestParameters: {},
      additionalSystemPrompt: "",
    },
    hotkeys: {
      "toggle-ai-agent-panel": ["Ctrl-Shift-B"],
    },
  };

  platformDefaults = {
    [Platform.macOS]: {
      hotkeys: {
        "toggle-ai-agent-panel": ["Cmd-Shift-B"],
      },
    },
  };
}
