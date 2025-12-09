import { Level } from 'level'
import path from 'path'
import { ACPConnectionManager } from './acp-connection.ts'
import { ProfileManager, type ACPProfile } from './acp-profiles.ts'

// Define task interface
interface Task {
  id: string
  title: string
  description: string
  status: 'todo' | 'in-progress' | 'done'
  priority: 'low' | 'medium' | 'high'
  createdAt: Date
  updatedAt: Date
}

// Initialize LevelDB
const dbPath = path.join(process.cwd(), 'db')
const db = new Level<string, Task>(dbPath, { valueEncoding: 'json' })

// Product Manager class to handle task operations
export class ProductManager {
  private db!: Level
  private profileManager: ProfileManager
  private profileSequence: ACPProfile[]
  private currentProfileIndex = 0
  private isProcessingProfile = false
  private dbReady = false

  constructor() {
    this.profileManager = new ProfileManager()
    this.profileSequence = this.profileManager.getProfileSequence()
    // Database will be opened on first use
  }

  // Create a new task
  async createTask(title: string, description: string, priority: 'low' | 'medium' | 'high' = 'medium'): Promise<Task> {
    // Ensure database is open
    if (!this.dbReady) {
      try {
        await db.open()
        this.dbReady = true
        console.log('[DB] Database opened successfully')
      } catch (error) {
        console.error('[DB] Failed to open database:', error)
        throw error
      }
    }

    const id = `task-${Date.now()}`
    const task: Task = {
      id,
      title,
      description,
      status: 'todo',
      priority,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    try {
      await db.put(id, task)
      console.log(`[DB] Created task: ${id}`)
      return task
    } catch (error) {
      console.error(`[DB] Failed to create task:`, error)
      throw error
    }
  }

  // Get all tasks
  async getAllTasks(): Promise<Task[]> {
    // Ensure database is open
    if (!this.dbReady) {
      try {
        await db.open()
        this.dbReady = true
        console.log('[DB] Database opened successfully')
      } catch (error) {
        console.error('[DB] Failed to open database:', error)
        return []
      }
    }

    const tasks: Task[] = []
    let iterator
    try {
      iterator = db.iterator()
      for await (const [key, value] of iterator) {
        tasks.push(value)
      }
    } catch (error) {
      console.error('[DB] Error reading tasks:', error)
      // Return empty array on error to prevent crashes
      return []
    } finally {
      if (iterator) {
        try {
          await iterator.close()
        } catch (closeError) {
          console.error('[DB] Error closing iterator:', closeError)
        }
      }
    }
    return tasks
  }

  // Update task status
  async updateTaskStatus(id: string, status: 'todo' | 'in-progress' | 'done'): Promise<Task> {
    // Ensure database is open
    if (!this.dbReady) {
      await db.open()
      this.dbReady = true
    }

    const task = await db.get(id)
    task.status = status
    task.updatedAt = new Date()
    await db.put(id, task)
    return task
  }

  // Update task priority
  async updateTaskPriority(id: string, priority: 'low' | 'medium' | 'high'): Promise<Task> {
    // Ensure database is open
    if (!this.dbReady) {
      await db.open()
      this.dbReady = true
    }

    const task = await db.get(id)
    task.priority = priority
    task.updatedAt = new Date()
    await db.put(id, task)
    return task
  }

  // Delete a task
  async deleteTask(id: string): Promise<void> {
    // Ensure database is open
    if (!this.dbReady) {
      await db.open()
      this.dbReady = true
    }

    await db.del(id)
  }

  // Execute task using ACP protocol with profile
  async runOpencodeWithProfile(profileName: string, context: any): Promise<{ output: string; errorOutput: string }> {
    const profile = this.profileManager.getProfile(profileName)
    if (!profile) {
      return { output: '', errorOutput: `Unknown profile: ${profileName}` }
    }

    const prompt = `${profile.systemPrompt}\n\n${profile.getTaskPrompt(context)}`
    console.log(`[ACP] Starting ${profile.role} profile communication`)

    try {
      const result = await this.executeWithACP(prompt, profileName)
      console.log(`[ACP] ${profile.role} profile communication completed`)
      return result
    } catch (error) {
      console.error(`[ACP] ${profile.role} profile communication error: ${error}`)
      const errorMsg = `Task execution failed: ACP connection failed: ${(error as Error).message}`
      return { output: '', errorOutput: errorMsg }
    }
  }

  // Execute task using ACP protocol only (legacy method)
  async runOpencode(prompt: string): Promise<{ output: string; errorOutput: string }> {
    console.log(`[ACP] Starting ACP protocol communication: ${prompt}`)

    try {
      // Execute using ACP protocol only
      const result = await this.executeWithACP(prompt)
      console.log('[ACP] ACP protocol communication completed')
      return result
    } catch (error) {
      console.error(`[ACP] ACP communication error: ${error}`)
      
      // Fail with error - no fallbacks
      const errorMsg = `Task execution failed: ACP connection failed: ${(error as Error).message}`
      return { output: '', errorOutput: errorMsg }
    }
  }

  // Execute task using ACP protocol
  private async executeWithACP(prompt: string, profileName: string = 'Unknown'): Promise<{ output: string; errorOutput: string }> {
    let connectionResult
    try {
      // Create ACP connection
      connectionResult = await ACPConnectionManager.createConnection()
      
      // Send prompt
      await ACPConnectionManager.sendPrompt(
        connectionResult.connection, 
        connectionResult.sessionId, 
        prompt
      )

      // Get task client from connection for response checking
      const profile = this.profileManager.getProfile(profileName)
      
      // Wait for completion using the actual task client that receives updates
      const result = await ACPConnectionManager.waitForTaskCompletion(connectionResult.taskClient, 30000, profile?.role || 'Unknown')
      
      return { output: result.output, errorOutput: result.error }
    } finally {
      // Clean up connection
      if (connectionResult) {
        await ACPConnectionManager.cleanupConnection(
          connectionResult.connection, 
          connectionResult.processResult
        )
      }
    }
  }

  private inferTaskType(prompt: string): string {
    const lowerPrompt = prompt.toLowerCase()
    if (lowerPrompt.includes('test') || lowerPrompt.includes('testing')) return 'testing'
    if (lowerPrompt.includes('document') || lowerPrompt.includes('docs')) return 'documentation'
    if (lowerPrompt.includes('fix') || lowerPrompt.includes('bug')) return 'bug_fix'
    if (lowerPrompt.includes('feature') || lowerPrompt.includes('implement')) return 'feature'
    if (lowerPrompt.includes('refactor') || lowerPrompt.includes('cleanup')) return 'refactoring'
    return 'general'
  }

  private generateTaskOutput(prompt: string, taskType: string): string {
    const outputs: Record<string, string> = {
      testing: `✅ Tests completed successfully\n- Ran ${Math.floor(Math.random() * 20) + 5} test cases\n- All assertions passed\n- Code coverage: ${Math.floor(Math.random() * 20) + 80}%`,
      documentation: `📚 Documentation generated\n- Created API documentation\n- Updated README with usage examples\n- Added inline code comments`,
      bug_fix: `🐛 Bug fixed successfully\n- Identified root cause in ${['data validation', 'error handling', 'state management'][Math.floor(Math.random() * 3)]}\n- Applied fix with proper testing\n- Verified fix doesn't break existing functionality`,
      feature: `✨ Feature implemented\n- Added new functionality as requested\n- Integrated with existing codebase\n- Added appropriate error handling and logging`,
      refactoring: `🔄 Code refactored\n- Improved code structure and readability\n- Removed code duplication\n- Maintained all existing functionality`,
      general: `✅ Task completed\n- Processed request: ${prompt.substring(0, 50)}...\n- All operations completed successfully`
    }

    return (outputs[taskType] || outputs.general) as string
  }

  private detectTaskErrors(output: string, errorOutput: string, taskDescription: string): boolean {
    // Check for explicit error indicators
    const errorIndicators = [
      'error', 'Error', 'ERROR', 'failed', 'Failed', 'FAILED',
      'exception', 'Exception', 'crash', 'Crash',
      'Method not found', 'command not found'
    ]

    const combinedOutput = (output + errorOutput).toLowerCase()

    // Check for error indicators
    for (const indicator of errorIndicators) {
      if (combinedOutput.includes(indicator.toLowerCase())) {
        return true
      }
    }

    // Check for task-specific failure conditions
    if (taskDescription.toLowerCase().includes('error') ||
        taskDescription.toLowerCase().includes('fail') ||
        taskDescription.toLowerCase().includes('exception')) {
      return true
    }

    return false
  }

  private detectTaskSuccess(output: string, errorOutput: string): boolean {
    // Check for success indicators
    const successIndicators = [
      'completed successfully', '✅', 'success', 'Success',
      'finished', 'Finished', 'done', 'Done',
      'Tests completed', 'Documentation generated',
      'Bug fixed', 'Feature implemented', 'Code refactored'
    ]

    const combinedOutput = (output + errorOutput).toLowerCase()

    // Must have at least one success indicator and no errors
    const hasSuccessIndicator = successIndicators.some(indicator =>
      combinedOutput.includes(indicator.toLowerCase())
    )

    return hasSuccessIndicator && !this.detectTaskErrors(output, errorOutput, '')
  }

  // Process tasks using multi-profile system
  async processTasksLoop(): Promise<void> {
    console.log('[APP] Starting multi-profile task processing loop...')

    while (true) {
      try {
        // Check if there's actual work to do
        const tasks = await this.getAllTasks()
        const todoTasks = tasks.filter(task => task.status === 'todo')
        
        if (todoTasks.length === 0) {
          console.log('[APP] No tasks to process. Waiting 10 seconds...')
          await new Promise(resolve => setTimeout(resolve, 10000))
          continue
        }

        // CRITICAL: Only proceed if NO profile is currently processing
        if (this.isProcessingProfile) {
          console.log('[APP] Profile already processing, waiting...')
          await new Promise(resolve => setTimeout(resolve, 10000))
          continue
        }

        const currentProfile = this.profileSequence[this.currentProfileIndex]
        if (!currentProfile) {
          throw new Error('Current profile is undefined')
        }
        
        console.log(`[APP] Current profile: ${currentProfile.role} (${currentProfile.name})`)
        console.log(`[APP] Processing ${todoTasks.length} todo tasks`)

        // CRITICAL: Set processing flag IMMEDIATELY to prevent race conditions
        this.isProcessingProfile = true

        try {
          if (currentProfile.name === 'product-manager') {
            await this.runProductManagerPhase()
          } else if (currentProfile.name === 'refinement') {
            await this.runRefinementPhase()
          } else if (currentProfile.name === 'development') {
            await this.runDevelopmentPhase()
          }
        } finally {
          // CRITICAL: Clear processing flag ONLY after phase completes
          this.isProcessingProfile = false
          console.log('[APP] Profile phase completed, processing flag cleared')
        }

        // CRITICAL: Move to next profile ONLY after current phase fully completes
        this.currentProfileIndex = (this.currentProfileIndex + 1) % this.profileSequence.length
        
        // Brief pause between profile cycles
        console.log('[APP] Profile cycle completed. Moving to next profile in 3 seconds...')
        await new Promise(resolve => setTimeout(resolve, 3000))

      } catch (error) {
        // CRITICAL: Ensure processing flag is cleared on error
        this.isProcessingProfile = false
        console.error('[APP] Error in profile processing loop:', error)
        console.log('[APP] Waiting 10 seconds before retrying...')
        await new Promise(resolve => setTimeout(resolve, 10000))
      }
    }
  }

  // Product Manager phase - create feature tickets
  private async runProductManagerPhase(): Promise<void> {
    console.log('[PRODUCT-MANAGER] Starting product management phase...')
    
    const { output, errorOutput } = await this.runOpencodeWithProfile('product-manager', {})
    
    if (errorOutput) {
      console.error('[PRODUCT-MANAGER] Error creating feature tickets:', errorOutput)
      return
    }

    // Parse output and create feature tickets
    const featureTickets = this.parseFeatureTickets(output)
    for (const ticket of featureTickets) {
      const priority = ticket.priority as 'low' | 'medium' | 'high'
      await this.createTask(ticket.title, ticket.description, priority)
      console.log(`[PRODUCT-MANAGER] Created feature ticket: ${ticket.title}`)
    }
    
    console.log(`[PRODUCT-MANAGER] Created ${featureTickets.length} feature tickets`)
  }

  // Refinement phase - break down features into tasks
  private async runRefinementPhase(): Promise<void> {
    console.log('[REFINEMENT] Starting refinement phase...')
    
    const tasks = await this.getAllTasks()
    const featureTickets = tasks.filter(task => task.status === 'todo' && !task.title.includes('Task:'))
    
    if (featureTickets.length === 0) {
      console.log('[REFINEMENT] No feature tickets to refine')
      return
    }

    const { output, errorOutput } = await this.runOpencodeWithProfile('refinement', { featureTickets })
    
    if (errorOutput) {
      console.error('[REFINEMENT] Error refining feature tickets:', errorOutput)
      return
    }

    // Parse output and create development tasks
    const devTasks = this.parseDevelopmentTasks(output)
    for (const task of devTasks) {
      const priority = task.priority as 'low' | 'medium' | 'high'
      await this.createTask(task.title, task.description, priority)
      console.log(`[REFINEMENT] Created development task: ${task.title}`)
    }
    
    console.log(`[REFINEMENT] Created ${devTasks.length} development tasks`)
  }

  // Development phase - execute development tasks
  private async runDevelopmentPhase(): Promise<void> {
    console.log('[DEVELOPMENT] Starting development phase...')
    
    const tasks = await this.getAllTasks()
    const devTasks = tasks.filter(task => 
      task.status === 'todo' && task.title.includes('Task:')
    )

    if (devTasks.length === 0) {
      console.log('[DEVELOPMENT] No development tasks to execute')
      return
    }

    console.log(`[DEVELOPMENT] Found ${devTasks.length} development tasks`)

    // Process each development task
    for (const task of devTasks) {
      console.log(`[DEVELOPMENT] Executing task: ${task.title}`)
      await this.updateTaskStatus(task.id, 'in-progress')

      try {
        const { output, errorOutput } = await this.runOpencodeWithProfile('development', { task })
        
        if (errorOutput) {
          console.error(`[DEVELOPMENT] Task failed: ${task.title}`, errorOutput)
          await this.updateTaskStatus(task.id, 'todo')
        } else {
          console.log(`[DEVELOPMENT] Task completed: ${task.title}`)
          await this.updateTaskStatus(task.id, 'done')
        }
      } catch (error) {
        console.error(`[DEVELOPMENT] Error executing task: ${task.title}`, error)
        await this.updateTaskStatus(task.id, 'todo')
      }
    }
    
    console.log('[DEVELOPMENT] Development phase completed')
  }

  // Parse feature tickets from AI output
  private parseFeatureTickets(output: string): Array<{title: string, description: string, priority: string}> {
    const tickets: Array<{title: string, description: string, priority: string}> = []
    
    // Simple parsing - look for ticket patterns
    const lines = output.split('\n')
    let currentTicket: any = {}
    
    for (const line of lines) {
      const trimmedLine = line.trim()
      
      if (trimmedLine.match(/^(\d+\.|\*|-)\s*(.+)$/)) {
        if (Object.keys(currentTicket).length > 0) {
          tickets.push(currentTicket)
        }
        currentTicket = { title: trimmedLine.replace(/^(\d+\.|\*|-)\s*/, ''), description: '', priority: 'medium' }
      } else if (trimmedLine.toLowerCase().includes('priority:')) {
        currentTicket.priority = trimmedLine.split(':')[1]?.trim() || 'medium'
      } else if (trimmedLine && !trimmedLine.match(/^(\d+\.|\*|-)/)) {
        currentTicket.description += (currentTicket.description ? ' ' : '') + trimmedLine
      }
    }
    
    if (Object.keys(currentTicket).length > 0) {
      tickets.push(currentTicket)
    }
    
    return tickets.filter(ticket => ticket.title)
  }

  // Parse development tasks from AI output
  private parseDevelopmentTasks(output: string): Array<{title: string, description: string, priority: string}> {
    const tasks: Array<{title: string, description: string, priority: string}> = []
    
    // Simple parsing - look for task patterns
    const lines = output.split('\n')
    let currentTask: any = {}
    
    for (const line of lines) {
      const trimmedLine = line.trim()
      
      if (trimmedLine.match(/^(\d+\.|\*|-)\s*(.+)$/)) {
        if (Object.keys(currentTask).length > 0) {
          tasks.push(currentTask)
        }
        const title = trimmedLine.replace(/^(\d+\.|\*|-)\s*/, '')
        currentTask = { title: `Task: ${title}`, description: '', priority: 'medium' }
      } else if (trimmedLine.toLowerCase().includes('priority:')) {
        currentTask.priority = trimmedLine.split(':')[1]?.trim() || 'medium'
      } else if (trimmedLine && !trimmedLine.match(/^(\d+\.|\*|-)/)) {
        currentTask.description += (currentTask.description ? ' ' : '') + trimmedLine
      }
    }
    
    if (Object.keys(currentTask).length > 0) {
      tasks.push(currentTask)
    }
    
    return tasks.filter(task => task.title)
  }
}

// Main function - Task Manager Daemon
async function main() {
  console.log('[DAEMON] Starting Opencode Task Manager Daemon')
  const pm = new ProductManager()
  console.log('[DAEMON] Initialized ProductManager')

  // Display current tasks
  const existingTasks = await pm.getAllTasks()
  console.log(`[DAEMON] Found ${existingTasks.length} existing tasks in database`)

  // Start the continuous task processing loop
  await pm.processTasksLoop()

  console.log('[DAEMON] Task processing daemon exited.')
}

// Run the application
main().catch(console.error)