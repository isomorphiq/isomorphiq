// ACP Client implementation for communicating with opencode
import { spawn } from 'child_process'
import { Writable, Readable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'

export class TaskClient {
  public responseText = ''
  public taskComplete = false
  public taskError = ''

  async sessionUpdate(params: any): Promise<void> {
    const update = params.update
    console.log('[ACP] Session update:', update.sessionUpdate)

    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text') {
          this.responseText += update.content.text
          console.log('[ACP] Message chunk:', update.content.text.slice(-50))
        }
        break
      case 'tool_call':
        console.log(`[ACP] Tool call: ${update.title} (${update.status})`)
        break
      case 'tool_call_update':
        console.log(`[ACP] Tool update: ${update.toolCallId} (${update.status})`)
        break
    }
  }

  async requestPermission(params: any): Promise<any> {
    console.log('[ACP] Permission requested:', params.toolCall.title)
    // Auto-approve all tool calls for task manager
    return {
      outcome: {
        outcome: 'selected',
        optionId: params.options[0]?.optionId || 'approve'
      }
    }
  }

  getResponse(): { output: string; error: string } {
    return {
      output: this.responseText,
      error: this.taskError
    }
  }

  markComplete(): void {
    this.taskComplete = true
  }

  markError(error: string): void {
    this.taskError = error
    this.taskComplete = true
  }
}