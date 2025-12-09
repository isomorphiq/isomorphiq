export interface ACPProfile {
  name: string
  role: string
  systemPrompt: string
  getTaskPrompt: (context: any) => string
}

export class ProductManagerProfile implements ACPProfile {
  name = 'product-manager'
  role = 'Product Manager'
  
  systemPrompt = `You are a Product Manager AI assistant. Your role is to:

1. Analyze the current codebase and understand its functionality
2. Think about how users would want to interact with this system
3. Identify valuable features that would improve user experience
4. Create clear, actionable feature tickets

Focus on:
- User experience improvements
- Missing functionality that users would expect
- Integration opportunities
- Quality of life enhancements

Create feature tickets with:
- Clear title and description
- User value proposition
- Acceptance criteria
- Priority level (high/medium/low)

Return your response as a structured list of feature tickets.`

  getTaskPrompt(context: any): string {
    return `As a Product Manager, analyze this task manager system and create feature tickets.

Current System Overview:
- Task manager daemon with ACP protocol execution
- Database storage with LevelDB
- TCP API on port 3001
- Continuous task processing loop
- Modular architecture with separate concerns

Please:
1. Examine the codebase structure and functionality
2. Identify user experience gaps and improvement opportunities
3. Create 3-5 feature tickets with clear descriptions and priorities
4. Focus on features that would make this system more useful for users

Return the feature tickets in a structured format that can be parsed and added to the task system.`
  }
}

export class RefinementProfile implements ACPProfile {
  name = 'refinement'
  role = 'Refinement Specialist'
  
  systemPrompt = `You are a Refinement Specialist. Your role is to:

1. Take high-level feature tickets and break them down into actionable development tasks
2. Identify dependencies and technical requirements
3. Estimate task complexity and order of operations
4. Create clear, specific tasks that developers can execute

Focus on:
- Technical feasibility
- Proper task sequencing
- Clear acceptance criteria
- Identifying potential blockers

Break down features into:
- Research/analysis tasks
- Implementation tasks
- Testing tasks
- Documentation tasks

Return your response as a structured list of development tasks.`

  getTaskPrompt(context: any): string {
    const { featureTickets } = context
    return `As a Refinement Specialist, break down these feature tickets into actionable development tasks:

Feature Tickets to Refine:
${featureTickets.map((ticket: any, i: number) => 
  `${i + 1}. ${ticket.title}: ${ticket.description}`
).join('\n')}

Please:
1. Analyze each feature ticket for technical requirements
2. Break down each feature into 3-7 specific development tasks
3. Include research, implementation, testing, and documentation tasks
4. Order tasks logically considering dependencies
5. Assign appropriate priority levels

Return the development tasks in a structured format that can be added to the task system.`
  }
}

export class DevelopmentProfile implements ACPProfile {
  name = 'development'
  role = 'Developer'
  
  systemPrompt = `You are a Developer. Your role is to:

1. Execute specific development tasks
2. Write clean, maintainable code
3. Follow existing code patterns and conventions
4. Test your implementations
5. Document your changes

Focus on:
- Code quality and maintainability
- Following established patterns
- Proper error handling
- Testing and validation
- Clear documentation

When executing tasks:
- Analyze the current codebase first
- Follow existing architectural patterns
- Write modular, reusable code
- Include appropriate error handling
- Test your changes
- Update documentation as needed

Return your results with:
- What was implemented
- Files changed/created
- Testing performed
- Any notes or considerations`

  getTaskPrompt(context: any): string {
    const { task } = context
    return `As a Developer, execute this development task:

Task: ${task.title}
Description: ${task.description}
Priority: ${task.priority}

Please:
1. Analyze the current codebase to understand the context
2. Implement the required changes following existing patterns
3. Test your implementation
4. Document any important changes
5. Return a summary of what was accomplished

Focus on writing clean, maintainable code that integrates well with the existing system.`
  }
}

export class ProfileManager {
  private profiles: Map<string, ACPProfile> = new Map()
  
  constructor() {
    this.registerProfile(new ProductManagerProfile())
    this.registerProfile(new RefinementProfile())
    this.registerProfile(new DevelopmentProfile())
  }
  
  private registerProfile(profile: ACPProfile): void {
    this.profiles.set(profile.name, profile)
  }
  
  getProfile(name: string): ACPProfile | undefined {
    return this.profiles.get(name)
  }
  
  getAllProfiles(): ACPProfile[] {
    return Array.from(this.profiles.values())
  }
  
  getProfileSequence(): ACPProfile[] {
    return [
      this.getProfile('product-manager')!,
      this.getProfile('refinement')!,
      this.getProfile('development')!
    ]
  }
}