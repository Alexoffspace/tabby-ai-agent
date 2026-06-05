import { ConfigProvider, Platform } from "tabby-core";

export type AIProvider = "openrouter" | "litellm";

export interface AIAgentConfig {
  llmEndpoint: string;
  autoApproveLowRiskCommands: boolean;
  additionalRequestParametersText: string;
  additionalRequestParameters: Record<string, any>;
}

export class AIAgentConfigProvider extends ConfigProvider {
  defaults = {
    aiAgent: {
      llmEndpoint: "",
      autoApproveLowRiskCommands: false,
      additionalRequestParametersText: "",
      additionalRequestParameters: {},
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
