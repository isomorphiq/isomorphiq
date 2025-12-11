import { BaseProfilePlugin } from "../src/plugin-system.ts";
import type { ACPProfile } from "../src/acp-profiles.ts";

/**
 * Example: Code Review Plugin
 * 
 * This plugin provides a specialized profile for code review tasks,
 * with configuration options for review strictness and focus areas.
 */
export default class CodeReviewPlugin extends BaseProfilePlugin {
    constructor() {
        super({
            name: "code-reviewer",
            version: "1.0.0",
            description: "Specialized AI profile for code review and quality assurance",
            author: "Plugin System Team",
            homepage: "https://github.com/example/code-review-plugin",
            repository: "https://github.com/example/code-review-plugin.git",
            license: "MIT",
            keywords: ["code-review", "quality", "testing", "static-analysis"],
            dependencies: [],
            engines: {
                node: ">=16.0.0",
                opencode: ">=1.0.0"
            }
        }, {
            type: "object",
            properties: {
                enabled: {
                    type: "boolean",
                    description: "Enable/disable the code reviewer plugin",
                    default: true
                },
                priority: {
                    type: "number",
                    description: "Plugin priority for task routing",
                    default: 75,
                    minimum: 1,
                    maximum: 100
                },
                settings: {
                    type: "object",
                    description: "Plugin-specific settings",
                    properties: {
                        strictness: {
                            type: "string",
                            description: "Review strictness level",
                            enum: ["lenient", "moderate", "strict", "paranoid"],
                            default: "moderate"
                        },
                        focusAreas: {
                            type: "array",
                            description: "Areas to focus on during review",
                            items: {
                                type: "string",
                                enum: ["security", "performance", "maintainability", "testing", "documentation", "style"]
                            },
                            default: ["security", "performance", "maintainability"]
                        },
                        autoApproveThreshold: {
                            type: "number",
                            description: "Auto-approve if score is above this threshold",
                            default: 8,
                            minimum: 1,
                            maximum: 10
                        },
                        requireTests: {
                            type: "boolean",
                            description: "Require tests for all code changes",
                            default: true
                        },
                        maxComplexity: {
                            type: "number",
                            description: "Maximum cyclomatic complexity allowed",
                            default: 10,
                            minimum: 1
                        }
                    },
                    required: ["strictness", "focusAreas"]
                }
            },
            required: ["enabled", "priority", "settings"]
        }, {
            enabled: true,
            priority: 75,
            settings: {
                strictness: "moderate",
                focusAreas: ["security", "performance", "maintainability"],
                autoApproveThreshold: 8,
                requireTests: true,
                maxComplexity: 10
            }
        });
    }
    
    getProfile(): ACPProfile {
        const config = this.getConfig();
        const settings = config.settings;
        
        return {
            name: this.metadata.name,
            role: "Code Reviewer",
            capabilities: [
                "code-review",
                "static-analysis", 
                "quality-assurance",
                "security-audit",
                "performance-analysis",
                "test-coverage-analysis"
            ],
            maxConcurrentTasks: 2,
            priority: config.priority,
            color: "#8b5cf6",
            icon: "🔍",
            
            systemPrompt: `You are a Code Reviewer AI assistant. Your role is to:

1. Thoroughly review code changes for quality, security, and maintainability
2. Identify potential bugs, security vulnerabilities, and performance issues
3. Ensure code follows best practices and coding standards
4. Verify that tests are adequate and comprehensive
5. Provide constructive feedback and improvement suggestions

Review Strictness: ${settings.strictness}
Focus Areas: ${settings.focusAreas.join(", ")}
Require Tests: ${settings.requireTests}
Max Complexity: ${settings.maxComplexity}

Focus on:
- Code security and vulnerability detection
- Performance optimization opportunities
- Code maintainability and readability
- Test coverage and quality
- Documentation completeness
- Adherence to coding standards

Provide reviews with:
- Overall assessment score (1-10)
- Specific issues found with line numbers
- Security concerns highlighted
- Performance recommendations
- Suggestions for improvement
- Approval/rejection recommendation

${settings.autoApproveThreshold ? `Auto-approve changes with score >= ${settings.autoApproveThreshold}` : "Manual approval required for all changes"}`,

            getTaskPrompt: (context: any) => {
                const { task, files, changes } = context;
                
                return `As a Code Reviewer, please review these code changes:

Task: ${task.title}
Description: ${task.description}

Files Changed:
${files.map((file: any) => `- ${file.path} (${file.type})`).join("\n")}

Changes to Review:
${changes.map((change: any) => `
File: ${change.file}
\`\`\`${change.language}
${change.diff}
\`\`\`
`).join("\n")}

Please provide a comprehensive code review covering:
1. Security vulnerabilities and concerns
2. Performance implications
3. Code quality and maintainability
4. Test coverage adequacy
5. Documentation completeness
6. Overall assessment (1-10 score)

Focus particularly on: ${settings.focusAreas.join(", ")}

${settings.requireTests ? "Ensure all changes have appropriate test coverage." : ""}

Provide specific, actionable feedback with line references where applicable.`
            }
        };
    }
    
    protected async onInitialize(): Promise<void> {
        console.log(`[CODE-REVIEW-PLUGIN] Initialized with strictness: ${this.getConfig().settings.strictness}`);
    }
    
    protected async onCleanup(): Promise<void> {
        console.log("[CODE-REVIEW-PLUGIN] Cleaned up successfully");
    }
    
    async onTaskStart(task: any): Promise<void> {
        console.log(`[CODE-REVIEW-PLUGIN] Starting review for task: ${task.title}`);
    }
    
    async onTaskComplete(task: any, result: any): Promise<void> {
        console.log(`[CODE-REVIEW-PLUGIN] Completed review for task: ${task.title}`);
        // Could track review metrics here
    }
    
    async onTaskError(task: any, error: Error): Promise<void> {
        console.error(`[CODE-REVIEW-PLUGIN] Error reviewing task ${task.title}:`, error.message);
    }
    
    async reload(): Promise<void> {
        console.log("[CODE-REVIEW-PLUGIN] Reloading configuration...");
        // Could reload external configuration files here
    }
}