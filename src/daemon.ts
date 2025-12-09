import { ProductManager } from './index.ts'
import { createServer, Socket } from 'net'
import { spawn } from 'child_process'

// Task Manager Daemon - runs the continuous task processing loop and handles MCP requests
async function main() {
  console.log('[DAEMON] Starting Opencode Task Manager Daemon')
  const pm = new ProductManager()
  console.log('[DAEMON] Initialized ProductManager')

  // Display current tasks
  const existingTasks = await pm.getAllTasks()
  console.log(`[DAEMON] Found ${existingTasks.length} existing tasks in database`)

  // Start TCP server for MCP communication
  const server = createServer((socket: Socket) => {
    console.log('[DAEMON] MCP client connected')

    socket.on('data', async (data) => {
      try {
        const message = JSON.parse(data.toString().trim())
        console.log('[DAEMON] Received command:', message.command)

        let result
        switch (message.command) {
          case 'create_task':
            result = await pm.createTask(
              message.data.title,
              message.data.description,
              message.data.priority || 'medium'
            )
            break
          case 'list_tasks':
            result = await pm.getAllTasks()
            break
          case 'get_task':
            const tasks = await pm.getAllTasks()
            result = tasks.find(t => t.id === message.data.id)
            break
          case 'update_task_status':
            result = await pm.updateTaskStatus(message.data.id, message.data.status)
            break
          case 'update_task_priority':
            result = await pm.updateTaskPriority(message.data.id, message.data.priority)
            break
           case 'delete_task':
             result = await pm.deleteTask(message.data.id)
             result = { success: true }
             break
           case 'restart':
             console.log('[DAEMON] Restart command received, spawning new daemon and exiting...')
             spawn('npm', ['run', 'daemon'], { cwd: process.cwd(), env: process.env, detached: true, stdio: 'ignore', shell: true })
             setTimeout(() => process.exit(0), 1000)
             result = { success: true, message: 'Restarting...' }
             break
           default:
             throw new Error(`Unknown command: ${message.command}`)
        }

        socket.write(JSON.stringify(result) + '\n')
      } catch (error) {
        console.error('[DAEMON] Error processing command:', error)
        socket.write(JSON.stringify({ error: (error as Error).message }) + '\n')
      }
    })

    socket.on('close', () => {
      console.log('[DAEMON] MCP client disconnected')
    })

    socket.on('error', (err) => {
      console.error('[DAEMON] Socket error:', err.message)
    })
  })

  const PORT = 3001
  server.listen(PORT, () => {
    console.log(`[DAEMON] TCP server listening on port ${PORT}`)
  })

  // Start the continuous task processing loop in parallel
  pm.processTasksLoop().catch((error) => {
    console.error('[DAEMON] Task processing loop error:', error)
  })

  console.log('[DAEMON] Daemon is running with both TCP server and task processing loop')
}

// Run the daemon
main().catch(console.error)