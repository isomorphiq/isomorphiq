import { ClientSideConnection } from '@agentclientprotocol/sdk'

export interface AcpClientInterface {
  requestPermission(params: any): Promise<any>
  sessionUpdate(params: any): Promise<void>
}

export class TaskClient implements AcpClientInterface {
  public responseText = ''
  public taskComplete = false
  public turnComplete = false
  public taskError = ''

  async sessionUpdate(params: any): Promise<void> {
    const update = params.update
    console.log(`[ACP] 🔄 Session update: ${update.sessionUpdate}`)
    console.log(`[ACP] 📝 Full update:`, JSON.stringify(update, null, 2))

    switch (update.sessionUpdate) {
      case 'tool_call':
        console.log(`[ACP] 🔧 Tool call START: ${update.title}`)
        console.log(`[ACP] 📋 Tool call details:`, JSON.stringify(update, null, 2))
        console.log(`[ACP] ⚡ Tool status: ${update.status}`)
        if (update.arguments) {
          console.log(`[ACP] 📤 Tool arguments:`, JSON.stringify(update.arguments, null, 2))
        }
        break
      case 'tool_call_update':
        console.log(`[ACP] 🔄 Tool UPDATE: ${update.toolCallId}`)
        console.log(`[ACP] 📊 Tool status: ${update.status}`)
        if (update.result) {
          console.log(`[ACP] 📥 Tool result:`, JSON.stringify(update.result, null, 2))
        }
        if (update.error) {
          console.log(`[ACP] ❌ Tool error:`, JSON.stringify(update.error, null, 2))
        }
        break
      case 'agent_message_chunk':
        if (update.content.type === 'text') {
          this.responseText += update.content.text
          // Write just the text without newline
          process.stdout.write(update.content.text)
        }
        break
      case 'turn_complete':
        console.log(`[ACP] ✅ Turn completed`)
        console.log(`[ACP] 📊 Turn stats:`, JSON.stringify(update, null, 2))
        this.turnComplete = true
        break
      case 'end_turn':
        console.log(`[ACP] ✅ End turn received`)
        console.log(`[ACP] 📊 End turn stats:`, JSON.stringify(update, null, 2))
        this.turnComplete = true
        break
      case 'session_complete':
        console.log(`[ACP] 🏁 Session completed`)
        console.log(`[ACP] 📋 Session summary:`, JSON.stringify(update, null, 2))
        this.taskComplete = true
        break
      default:
        console.log(`[ACP] ❓ Unknown update type: ${update.sessionUpdate}`)
    }
  }

  async requestPermission(params: any): Promise<any> {
    console.log(`[ACP] 🔐 Permission requested for: ${params.toolCall.title}`)
    console.log(`[ACP] 📋 Permission details:`, JSON.stringify(params, null, 2))
    console.log(`[ACP] ✅ Auto-approving tool call`)
    
    // Auto-approve all tool calls for task manager
    const response = {
      outcome: {
        outcome: 'selected',
        optionId: params.options[0]?.optionId || 'approve'
      }
    }
    console.log(`[ACP] 📤 Permission response:`, JSON.stringify(response, null, 2))
    return response
  }

  getResponse(): { output: string; error: string } {
    return {
      output: this.responseText,
      error: this.taskError
    }
  }

  isTurnComplete(): boolean {
    return this.turnComplete || this.taskComplete
  }
}