import { Component, HostBinding, OnInit } from "@angular/core";
import { ConfigService } from "tabby-core";
import { checkpointLLMEndpoint } from "../lib/llm_chat_session";

@Component({
  templateUrl: "./agent_settings.html",
  styleUrls: ["./agent_settings.scss"],
})
export class AIAgentSettingsComponent implements OnInit {
  @HostBinding("class.content-box") true;
  additionalRequestParametersText = "";
  additionalRequestParametersError: string | null = null;
  endpointCheckpointStatus:
    | "idle"
    | "checking"
    | "valid"
    | "invalid"
    | "empty" = "idle";
  endpointCheckpointMessage = "";
  private endpointCheckpointSequence = 0;

  constructor(public config: ConfigService) {}

  ngOnInit(): void {
    this.ensureConfigDefaults();
    this.additionalRequestParametersText =
      this.config.store.aiAgent.additionalRequestParametersText;
  }

  async saveLLMEndpoint(value: string): Promise<void> {
    const endpoint = this.normalizeEndpoint(value);
    this.config.store.aiAgent.llmEndpoint = endpoint;
    await this.config.save();
  }

  checkLLMEndpoint(): void {
    this.startEndpointCheckpoint(this.config.store.aiAgent.llmEndpoint);
  }

  async saveAutoApproveLowRiskCommands(value: boolean): Promise<void> {
    this.config.store.aiAgent.autoApproveLowRiskCommands = value;
    await this.config.save();
  }

  async saveAdditionalRequestParametersText(value: string): Promise<void> {
    this.additionalRequestParametersText = value;

    const parsed = this.parseAdditionalRequestParameters(value);
    if (!parsed.ok) {
      this.additionalRequestParametersError = parsed.error;
      return;
    }

    this.additionalRequestParametersError = null;
    this.config.store.aiAgent.additionalRequestParametersText = value;
    this.config.store.aiAgent.additionalRequestParameters = parsed.value;
    await this.config.save();
  }

  private ensureConfigDefaults(): void {
    this.config.store.aiAgent ??= {};
    this.config.store.aiAgent.llmEndpoint ??= "";
    this.config.store.aiAgent.autoApproveLowRiskCommands ??= false;
    this.config.store.aiAgent.additionalRequestParametersText ??= "";
    this.config.store.aiAgent.additionalRequestParameters ??= {};
  }

  private normalizeEndpoint(value: string): string {
    let normalized = value.trim();
    normalized = normalized.replace(/\/v1\/chat\/completions\/?$/i, "");
    normalized = normalized.replace(/\/+$/, "");
    return normalized;
  }

  private startEndpointCheckpoint(endpoint: string): void {
    const sequence = ++this.endpointCheckpointSequence;
    if (!endpoint) {
      this.endpointCheckpointStatus = "empty";
      this.endpointCheckpointMessage = "Add a base URL to check the endpoint.";
      return;
    }

    this.endpointCheckpointStatus = "checking";
    this.endpointCheckpointMessage = "Checking endpoint...";
    void this.checkEndpoint(endpoint, sequence);
  }

  private async checkEndpoint(endpoint: string, sequence: number): Promise<void> {
    try {
      await checkpointLLMEndpoint(endpoint);
      if (sequence !== this.endpointCheckpointSequence) {
        return;
      }

      this.endpointCheckpointStatus = "valid";
      this.endpointCheckpointMessage = "Endpoint accepted the checkpoint request.";
    } catch (error) {
      if (sequence !== this.endpointCheckpointSequence) {
        return;
      }

      this.endpointCheckpointStatus = "invalid";
      this.endpointCheckpointMessage =
        error instanceof Error
          ? error.message
          : "Endpoint checkpoint request failed.";
    }
  }

  private parseAdditionalRequestParameters(
    value: string,
  ):
    | { ok: true; value: Record<string, any> }
    | { ok: false; error: string } {
    const trimmed = value.trim();
    if (!trimmed) {
      return { ok: true, value: {} };
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (!this.isPlainObject(parsed)) {
        return {
          ok: false,
          error: "Additional request parameters must be a JSON object.",
        };
      }

      return { ok: true, value: parsed };
    } catch {
      return {
        ok: false,
        error: "Additional request parameters must be valid JSON.",
      };
    }
  }

  private isPlainObject(value: unknown): value is Record<string, any> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
