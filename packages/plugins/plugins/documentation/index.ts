import { BaseProfilePlugin } from "@isomorphiq/plugins";
import type { ACPProfile } from "@isomorphiq/user-profile";

/**
 * Example: Documentation Generator Plugin
 * 
 * This plugin provides a specialized profile for automatic documentation
 * generation and maintenance tasks.
 */
export default class DocumentationPlugin extends BaseProfilePlugin {
    constructor() {
        super({
            name: "documentation-generator",
            version: "1.2.0",
            description: "AI-powered documentation generation and maintenance specialist",
            author: "Documentation Team",
            homepage: "https://docs.example.com/plugins/documentation-generator",
            repository: "https://github.com/example/documentation-plugin.git",
            license: "Apache-2.0",
            keywords: ["documentation", "api-docs", "markdown", "technical-writing"],
            dependencies: [],
            engines: {
                node: ">=16.0.0",
                opencode: ">=1.0.0"
            }
        }, undefined, {
            enabled: true,
            priority: 60,
            settings: {
                outputFormat: "markdown",
                includeExamples: true,
                generateApiDocs: true,
                includeDiagrams: false,
            targetAudience: "developers",
                updateFrequency: "on-change"
            }
        });
    }
    
    getProfile(): ACPProfile {
        const config = this.getConfig();
        const settings = config.settings as Record<string, unknown>;
        const targetAudience = String(settings.targetAudience ?? "");
        
        return {
            name: this.metadata.name,
            role: "Documentation Specialist",
            principalType: "agent",
            capabilities: [
                "documentation-generation",
                "api-documentation",
                "technical-writing",
                "markdown-processing",
                "diagram-generation",
                "doc-maintenance"
            ],
            maxConcurrentTasks: 3,
            priority: config.priority,
            color: "#06b6d4",
            icon: "📚",
            
            systemPrompt: `You are a Documentation Specialist AI assistant. Your role is to:

1. Generate comprehensive, clear, and accurate documentation
2. Create API documentation from code analysis
3. Write user guides and technical documentation
4. Maintain and update existing documentation
5. Ensure documentation follows best practices and standards

Documentation Settings:
- Output Format: ${settings.outputFormat}
- Include Examples: ${settings.includeExamples}
- Generate API Docs: ${settings.generateApiDocs}
- Include Diagrams: ${settings.includeDiagrams}
- Target Audience: ${settings.targetAudience}
- Update Frequency: ${settings.updateFrequency}

Focus on:
- Clarity and readability
- Comprehensive coverage
- Accurate technical information
- Proper structure and organization
- Consistent formatting and style
- Audience-appropriate language

Documentation Principles:
- Write clear, concise, and unambiguous text
- Include relevant code examples when helpful
- Provide step-by-step instructions for procedures
- Use consistent terminology throughout
- Include troubleshooting information where relevant
- Maintain proper document structure and navigation

Target Audience Considerations:
${this.getAudienceGuidance(targetAudience)}`,

            getTaskPrompt: (context: any) => {
                const { task, codebase, existingDocs } = context;
                
                return `As a Documentation Specialist, please handle this documentation task:

Task: ${task.title}
Description: ${task.description}

${codebase ? `Codebase Information:
- Language: ${codebase.language || "Unknown"}
- Framework: ${codebase.framework || "Unknown"}
- Size: ${codebase.files?.length || 0} files
- Main Components: ${codebase.components?.join(", ") || "N/A"}` : ""}

${existingDocs ? `Existing Documentation:
${existingDocs.map((doc: any) => `- ${doc.title} (${doc.format}, last updated: ${doc.updated})`).join("\n")}` : ""}

Requirements:
- Output Format: ${settings.outputFormat}
- Include Examples: ${settings.includeExamples ? "Yes" : "No"}
- Target Audience: ${settings.targetAudience}
- Include Diagrams: ${settings.includeDiagrams ? "Yes" : "No"}

Please:
1. Analyze the provided codebase and existing documentation
2. Generate comprehensive documentation as requested
3. Ensure the documentation is appropriate for the target audience
4. Include relevant code examples if requested
5. Follow best practices for technical writing
6. Provide the documentation in the specified format

Focus on creating documentation that is clear, accurate, and valuable for ${settings.targetAudience}.`
            }
        };
    }
    
    private getAudienceGuidance(audience: string): string {
        switch (audience) {
            case "developers":
                return "- Focus on technical details, API references, and implementation examples\n- Include code snippets and architectural information\n- Assume programming knowledge and familiarity with concepts";
            case "users":
                return "- Focus on user-facing features and step-by-step instructions\n- Use non-technical language and avoid jargon\n- Include screenshots and practical examples";
            case "administrators":
                return "- Focus on configuration, deployment, and maintenance procedures\n- Include system requirements and troubleshooting guides\n- Provide security and backup procedures";
            case "all":
                return "- Create layered documentation suitable for different audiences\n- Include both technical and non-technical sections\n- Provide clear navigation and audience indicators";
            default:
                return "- Adapt content to be accessible and informative";
        }
    }
    
    protected async onInitialize(): Promise<void> {
        console.log(`[DOCUMENTATION-PLUGIN] Initialized for ${this.getConfig().settings.targetAudience} audience`);
    }
    
    protected async onCleanup(): Promise<void> {
        console.log("[DOCUMENTATION-PLUGIN] Cleaned up successfully");
    }
    
    async onTaskStart(task: any): Promise<void> {
        console.log(`[DOCUMENTATION-PLUGIN] Starting documentation task: ${task.title}`);
    }
    
    async onTaskComplete(task: any, result: any): Promise<void> {
        console.log(`[DOCUMENTATION-PLUGIN] Completed documentation task: ${task.title}`);
        // Could track documentation metrics here
    }
    
    async onTaskError(task: any, error: Error): Promise<void> {
        console.error(`[DOCUMENTATION-PLUGIN] Error in documentation task ${task.title}:`, error.message);
    }
    
    async reload(): Promise<void> {
        console.log("[DOCUMENTATION-PLUGIN] Reloading documentation templates and settings...");
        // Could reload documentation templates here
    }
}
