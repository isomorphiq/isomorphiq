import { spawn } from 'child_process'
import { Writable, Readable } from 'node:stream'

export interface ProcessResult {
  process: any
  input: any
  outputStream: any
}

export class ProcessSpawner {
  static spawnOpencode(): ProcessResult {
    console.log('[PROCESS] Spawning opencode as ACP server...')
    
    const opencodeProcess = spawn('opencode', ['acp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: { ...process.env }
    })


    const input = Writable.toWeb(opencodeProcess.stdin)
    const outputStream = Readable.toWeb(opencodeProcess.stdout)

    console.log('[PROCESS] Opencode process spawned successfully')
    
    return {
      process: opencodeProcess,
      input,
      outputStream
    }
  }

  static cleanupProcess(processResult: ProcessResult): void {
    try {
      if (processResult.process) {
        processResult.process.kill('SIGTERM')
        console.log('[PROCESS] Process terminated')
      }
    } catch (error) {
      console.log('[PROCESS] Error terminating process:', error)
    }
  }
}