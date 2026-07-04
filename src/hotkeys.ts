import { Injectable } from "@angular/core";
import {
  HotkeyDescription,
  HotkeyProvider,
  TranslateService,
} from "tabby-core";

@Injectable()
export class AIAgentHotkeyProvider extends HotkeyProvider {
  constructor(private translate: TranslateService) {
    super();
  }

  async provide(): Promise<HotkeyDescription[]> {
    return [
      {
        id: "toggle-ai-agent-panel",
        name: this.translate.instant("Toggle AI Agent Panel"),
      },
      {
        id: "approve-ai-agent-command",
        name: this.translate.instant("Approve AI Agent Command"),
      },
      {
        id: "decline-ai-agent-command",
        name: this.translate.instant("Decline AI Agent Command"),
      },
    ];
  }
}
