import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'
import { AIAgentSettingsComponent } from './components/ai_agent_settings.component'

@Injectable()
export class AISettingsTabProvider extends SettingsTabProvider {
    id = 'ai-agent'
    icon = 'robot'
    title = 'AI Agent'

    getComponentType (): any {
        return AIAgentSettingsComponent
    }
}
