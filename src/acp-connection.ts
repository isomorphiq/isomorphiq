import { ClientSideConnection } from '@agentclientprotocol/sdk'
import { TaskClient } from './acp-client.ts'
import { ProcessSpawner, type ProcessResult } from './process-spawner.ts'

export interface ACPConnectionResult {
  connection: ClientSideConnection
  sessionId: string
  processResult: ProcessResult
}

export class ACPConnectionManager {
  static async createConnection(): Promise<ACPConnectionResult> {
    console.log('[ACP] Creating ACP connection...')
    
    // Spawn opencode process
    const processResult = ProcessSpawner.spawnOpencode()
    
    // Set up ACP communication streams
    const acp = await import('@agentclientprotocol/sdk')
    const stream = acp.ndJsonStream(processResult.input, processResult.outputStream)
    
    // Create task client and connection
    const taskClient = new TaskClient()
    const connection = new acp.ClientSideConnection(() => taskClient, stream)

    // Initialize connection
    console.log('[ACP] Initializing ACP connection...')
    const initResult = await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
      },
    })
    console.log(`[ACP] Connected to opencode (protocol v${initResult.protocolVersion})`)

    // Create session
    console.log('[ACP] Creating new session...')
    const sessionResult = await connection.newSession({
      cwd: process.cwd(),
      mcpServers: [],
    })
    console.log(`[ACP] Session created: ${sessionResult.sessionId}`)

    return {
      connection,
      sessionId: sessionResult.sessionId,
      processResult
    }
  }

  static async cleanupConnection(connection: ClientSideConnection, processResult: ProcessResult): Promise<void> {
    try {
      console.log('[ACP] Cleaning up connection...')
      await connection.closed
      console.log('[ACP] Connection closed')
    } catch (error) {
      console.log('[ACP] Error closing connection:', error)
    }
    
    ProcessSpawner.cleanupProcess(processResult)
  }

  static async sendPrompt(connection: ClientSideConnection, sessionId: string, prompt: string): Promise<any> {
    console.log('[ACP] Sending prompt turn request...')
    const result = await connection.prompt({
      sessionId,
      prompt: [
        {
          type: 'text',
          text: prompt
        }
      ],
    })
    console.log(`[ACP] Prompt completed with stop reason: ${result.stopReason}`)
    return result
  }

  static async waitForTaskCompletion(taskClient: TaskClient, timeoutMs: number = 30000): Promise<{ output: string; error: string }> {
    console.log(`[ACP] Waiting for task completion (timeout: ${timeoutMs}ms)...`)
    const startTime = Date.now()
    
    while (!taskClient.getResponse().output && !taskClient.getResponse().error && Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    const response = taskClient.getResponse()
    
    if (response.output) {
      console.log('[ACP] Task completed successfully via ACP')
      return { output: response.output, error: '' }
    } else if (response.error) {
      console.error('[ACP] Task failed via ACP:', response.error)
      return { output: '', error: response.error }
    } else {
      const errorMsg = `Task timed out after ${timeoutMs}ms`
      console.log('[ACP] Task timed out')
      return { output: '', error: errorMsg }
    }
  }
}