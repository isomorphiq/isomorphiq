import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js'
import { createConnection } from 'net'
import { exec } from 'child_process'

// TCP client to communicate with the daemon
class DaemonClient {
  private port: number = 3001
  private host: string = 'localhost'

  async sendCommand(command: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const client = createConnection({ port: this.port, host: this.host }, () => {
        console.log('[MCP] Connected to daemon')
        const message = JSON.stringify({ command, data }) + '\n'
        client.write(message)
      })

      let response = ''
      client.on('data', (data) => {
        response += data.toString()
        try {
          const result = JSON.parse(response.trim())
          client.end()
          resolve(result)
        } catch (e) {
          // Wait for more data
        }
      })

      client.on('error', (err) => {
        console.error('[MCP] Daemon connection error:', err.message)
        reject(new Error('Failed to connect to daemon'))
      })

      client.on('close', () => {
        if (!response) {
          reject(new Error('Connection closed without response'))
        }
      })

      // Timeout after 5 seconds
      setTimeout(() => {
        client.destroy()
        reject(new Error('Request timeout'))
      }, 5000)
    })
  }

  async checkStatus(): Promise<{ running: boolean; message: string }> {
    return new Promise((resolve) => {
      const client = createConnection({ port: this.port, host: this.host }, () => {
        client.end()
        resolve({ running: true, message: 'Daemon is running and accepting connections' })
      })

      client.on('error', () => {
        resolve({ running: false, message: 'Daemon is not running or not accessible' })
      })

      // Timeout after 2 seconds
      setTimeout(() => {
        client.destroy()
        resolve({ running: false, message: 'Daemon connection timeout' })
      }, 2000)
    })
  }
}

// Create daemon client
const daemonClient = new DaemonClient()

// Define the MCP server
const server = new Server(
  {
    name: 'task-manager-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// Define available tools
const tools: Tool[] = [
  {
    name: 'check_daemon_status',
    description: 'Check if the task-manager daemon is running and accessible',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'start_daemon',
    description: 'Start the task-manager daemon if it is not running',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task with title, description, and priority',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The title of the task',
        },
        description: {
          type: 'string',
          description: 'The description of the task',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'The priority level of the task',
          default: 'medium',
        },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List all tasks in the database',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_task',
    description: 'Get a specific task by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the task to retrieve',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'update_task_status',
    description: 'Update the status of a task',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the task to update',
        },
        status: {
          type: 'string',
          enum: ['todo', 'in-progress', 'done'],
          description: 'The new status of the task',
        },
      },
      required: ['id', 'status'],
    },
  },
  {
    name: 'update_task_priority',
    description: 'Update the priority of a task',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the task to update',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'The new priority of the task',
        },
      },
      required: ['id', 'priority'],
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The ID of the task to delete',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'restart_daemon',
    description: 'Gracefully restart the task-manager daemon after finishing current task',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools }
})

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  if (!args) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: No arguments provided',
        },
      ],
      isError: true,
    }
  }

  try {
    switch (name) {
      case 'check_daemon_status':
        const status = await daemonClient.checkStatus()
        return {
          content: [
            {
              type: 'text',
              text: `Daemon status: ${status.running ? 'Running' : 'Not running'}\n${status.message}`,
            },
          ],
        }

      case 'create_task':
        const newTask = await daemonClient.sendCommand('create_task', {
          title: args.title as string,
          description: args.description as string,
          priority: (args.priority as 'low' | 'medium' | 'high') || 'medium'
        })
        return {
          content: [
            {
              type: 'text',
              text: `Task created successfully: ${JSON.stringify(newTask, null, 2)}`,
            },
          ],
        }

      case 'list_tasks':
        const tasks = await daemonClient.sendCommand('list_tasks', {})
        return {
          content: [
            {
              type: 'text',
              text: `Found ${tasks.length} tasks:\n${JSON.stringify(tasks, null, 2)}`,
            },
          ],
        }

      case 'get_task':
        const task = await daemonClient.sendCommand('get_task', { id: args.id as string })
        if (!task) {
          throw new Error(`Task with ID ${args.id} not found`)
        }
        return {
          content: [
            {
              type: 'text',
              text: `Task details:\n${JSON.stringify(task, null, 2)}`,
            },
          ],
        }

      case 'update_task_status':
        const updatedTask = await daemonClient.sendCommand('update_task_status', {
          id: args.id as string,
          status: args.status as string
        })
        return {
          content: [
            {
              type: 'text',
              text: `Task status updated successfully: ${JSON.stringify(updatedTask, null, 2)}`,
            },
          ],
        }

      case 'update_task_priority':
        const priorityUpdatedTask = await daemonClient.sendCommand('update_task_priority', {
          id: args.id as string,
          priority: args.priority as string
        })
        return {
          content: [
            {
              type: 'text',
              text: `Task priority updated successfully: ${JSON.stringify(priorityUpdatedTask, null, 2)}`,
            },
          ],
        }

      case 'delete_task':
        await daemonClient.sendCommand('delete_task', { id: args.id as string })
        return {
          content: [
            {
              type: 'text',
              text: `Task ${args.id} deleted successfully`,
            },
          ],
        }

      case 'restart_daemon':
        await daemonClient.sendCommand('restart', {})
        return {
          content: [
            {
              type: 'text',
              text: `Daemon restart initiated. It will finish current task and restart gracefully.`,
            },
          ],
        }

       case 'start_daemon':
         const startStatus = await daemonClient.checkStatus()
         if (startStatus.running) {
           return {
             content: [
               {
                 type: 'text',
                 text: `Daemon is already running.`,
               },
             ],
           }
         } else {
           exec('npm run daemon &', { cwd: process.cwd(), env: process.env })
           return {
             content: [
               {
                 type: 'text',
                 text: `Daemon start initiated.`,
               },
             ],
           }
         }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${(error as Error).message}`,
        },
      ],
      isError: true,
    }
  }
})

// Start the server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Task Manager MCP server started')
}

main().catch((error) => {
  console.error('MCP server error:', error)
  process.exit(1)
})