# Plugin-Style Profile System for ACP Integration

## Overview

This document describes the comprehensive plugin-style profile system implemented for the Agent Client Protocol (ACP) integration. The system provides a flexible, secure, and extensible architecture for dynamically loading and managing AI profiles as plugins.

## Architecture

### Core Components

1. **Plugin System Framework** (`src/plugin-system.ts`)
   - Defines interfaces and base classes for plugins
   - Provides plugin lifecycle management
   - Implements configuration validation and health monitoring

2. **Plugin Loader** (`src/plugin-loader.ts`)
   - Handles dynamic plugin discovery and loading
   - Supports multiple plugin formats (CommonJS, ES modules)
   - Provides validation and metadata extraction

3. **Plugin Manager** (`src/plugin-manager.ts`)
   - Central registry for all plugins
   - Manages plugin lifecycle and configuration
   - Provides event-driven architecture for plugin events

4. **Plugin Sandbox** (`src/plugin-sandbox.ts`)
   - Security isolation for plugin execution
   - Resource limits and monitoring
   - Security validation and policy enforcement

5. **Enhanced Profile Manager** (`src/enhanced-profile-manager.ts`)
   - Integrates plugin system with existing profile management
   - Provides unified interface for built-in and plugin profiles
   - Enhanced task routing with plugin capabilities

## Plugin Development

### Creating a Plugin

All plugins must implement the `ProfilePlugin` interface:

```typescript
import { BaseProfilePlugin } from "./src/plugin-system.ts";
import type { ACPProfile } from "@isomorphiq/user-profile";

export default class MyPlugin extends BaseProfilePlugin {
    constructor() {
        super({
            name: "my-plugin",
            version: "1.0.0",
            description: "My custom plugin",
            author: "Your Name",
            license: "MIT",
            keywords: ["custom", "ai", "profile"]
        }, {
            // Configuration schema
            type: "object",
            properties: {
                enabled: { type: "boolean", default: true },
                priority: { type: "number", default: 50 }
            }
        }, {
            // Default configuration
            enabled: true,
            priority: 50,
            settings: {}
        });
    }
    
    getProfile(): ACPProfile {
        return {
            name: this.metadata.name,
            role: "Custom Role",
            capabilities: ["custom-capability"],
            maxConcurrentTasks: 1,
            priority: this.getConfig().priority,
            color: "#ff6b6b",
            icon: "🔧",
            systemPrompt: "You are a custom AI assistant...",
            getTaskPrompt: (context) => `Handle this task: ${context.task.title}`
        };
    }
}
```

### Plugin Metadata

Each plugin must provide metadata including:

- **name**: Unique plugin identifier
- **version**: Semantic version
- **description**: Plugin purpose and functionality
- **author**: Plugin author information
- **license**: Software license
- **keywords**: Searchable keywords
- **dependencies**: Required plugins (optional)
- **engines**: Runtime requirements (optional)

### Configuration Schema

Plugins can define a JSON schema for configuration validation:

```typescript
const configSchema = {
    type: "object",
    properties: {
        enabled: {
            type: "boolean",
            description: "Enable/disable plugin",
            default: true
        },
        priority: {
            type: "number",
            description: "Plugin priority for task routing",
            minimum: 1,
            maximum: 100,
            default: 50
        },
        settings: {
            type: "object",
            properties: {
                customSetting: {
                    type: "string",
                    enum: ["option1", "option2"],
                    default: "option1"
                }
            }
        }
    },
    required: ["enabled", "priority"]
};
```

## Plugin Lifecycle

### States

- **unloaded**: Plugin not loaded
- **loading**: Plugin is being loaded
- **loaded**: Plugin loaded but inactive
- **active**: Plugin loaded and active
- **inactive**: Plugin loaded but disabled
- **error**: Plugin encountered an error
- **unloading**: Plugin is being unloaded

### Methods

- **initialize(config?)**: Initialize plugin with configuration
- **getProfile()**: Return ACP profile instance
- **cleanup()**: Clean up plugin resources
- **validateConfig(config)**: Validate plugin configuration
- **getHealth()**: Return plugin health status
- **reload()**: Hot-reload plugin (optional)

### Event Handlers

Plugins can implement optional event handlers:

```typescript
async onTaskStart(task: any): Promise<void> {
    console.log(`Starting task: ${task.title}`);
}

async onTaskComplete(task: any, result: any): Promise<void> {
    console.log(`Completed task: ${task.title}`);
}

async onTaskError(task: any, error: Error): Promise<void> {
    console.error(`Task error: ${error.message}`);
}
```

## Security Features

### Sandboxing

All plugins execute in a secure sandbox with:

- **Module Access Control**: Only allowed modules can be imported
- **File System Restrictions**: Limited file system access
- **Resource Limits**: Memory, CPU, and operation limits
- **Network Controls**: Restricted network access

### Resource Limits

Default limits can be customized per plugin:

```typescript
const sandbox = securityManager.createSandbox(plugin, {
    maxMemory: 100 * 1024 * 1024, // 100MB
    maxCpuTime: 30000, // 30 seconds
    maxFileOperations: 1000,
    maxNetworkRequests: 10,
    allowedModules: ["fs", "path", "crypto"],
    allowedPaths: ["/safe/directory"]
});
```

### Security Validation

Automatic validation of:

- Dangerous configuration settings
- Unsafe file path access
- Network security policies
- Path traversal attempts

## Plugin Management

### Installation

```typescript
import { EnhancedProfileManager } from "./src/enhanced-profile-manager.ts";

const profileManager = new EnhancedProfileManager();

// Install from file
await profileManager.installPlugin("./plugins/my-plugin.ts");

// Install with configuration
await profileManager.installPlugin("./plugins/my-plugin.ts", {
    enabled: true,
    priority: 75,
    settings: { customMode: "advanced" }
});
```

### Discovery

Plugins are automatically discovered from directories:

```typescript
// Load all plugins from directory
await profileManager.getPluginManager().loadPluginsFromDirectory("./plugins");

// Discover available plugins
const pluginFiles = await profileManager.getPluginManager()
    .getPluginLoader().discoverPlugins("./plugins");
```

### Configuration Management

```typescript
// Enable/disable plugin
await profileManager.enablePlugin("my-plugin");
await profileManager.disablePlugin("my-plugin");

// Update configuration
await profileManager.getPluginManager()
    .savePluginConfig("my-plugin", newConfig);

// Reload plugin
await profileManager.reloadPlugin("my-plugin");
```

### Monitoring

```typescript
// Get plugin system status
const status = await profileManager.getPluginSystemStatus();
console.log(`Active plugins: ${status.activePlugins}/${status.totalPlugins}`);

// Check plugin health
const health = await profileManager.getPluginManager()
    .checkPluginHealth("my-plugin");

// Get security report
const securityReport = profileManager.getSecurityManager()
    .getSecurityReport();
```

## Example Plugins

### Code Review Plugin

Located at: `plugins/code-review-plugin.ts`

Provides specialized code review capabilities with:

- Configurable review strictness
- Focus area selection (security, performance, etc.)
- Auto-approval thresholds
- Test requirement enforcement

### Documentation Plugin

Located at: `plugins/documentation-plugin.ts`

Provides documentation generation with:

- Multiple output formats (Markdown, HTML, PDF)
- Audience-specific content
- API documentation generation
- Diagram support

## Integration with Existing System

### Backward Compatibility

The plugin system is fully backward compatible with existing profiles:

- Built-in profiles continue to work unchanged
- Existing ProfileManager API preserved
- Gradual migration path available

### Enhanced Task Routing

Plugin profiles are prioritized based on:

1. Capability matching with task requirements
2. Plugin priority configuration
3. Current plugin load and availability
4. Historical performance metrics

### Event System

Comprehensive event system for:

- Plugin registration/unregistration
- State changes
- Health updates
- Task lifecycle events
- Security violations

## Configuration

### Plugin Directory Structure

```
plugins/
├── code-review-plugin.ts
├── documentation-plugin.ts
├── custom-plugin/
│   ├── index.ts
│   ├── package.json
│   └── README.md
└── experimental/
    └── beta-plugin.ts
```

### Configuration Files

- `config/plugins.json`: Plugin configurations
- `plugins/*/package.json`: Plugin metadata
- Plugin-specific config files in plugin directories

### Environment Variables

- `PLUGIN_DIR`: Custom plugins directory
- `PLUGIN_CONFIG_PATH`: Custom config file path
- `PLUGIN_SECURITY_LEVEL`: Security strictness (low/medium/high)

## Testing

### Running Tests

```bash
# Run comprehensive plugin system tests
node test-plugin-system.ts

# Test specific plugin
node test-plugin-system.ts --plugin=code-review-plugin

# Run security tests
node test-plugin-system.ts --security
```

### Test Coverage

- Plugin creation and registration
- Configuration validation
- Lifecycle management
- Security sandboxing
- Resource limits
- Error handling
- Integration scenarios

## Best Practices

### Plugin Development

1. **Use BaseProfilePlugin**: Extend the base class for consistency
2. **Define Configuration Schema**: Enable proper validation
3. **Handle Errors Gracefully**: Implement proper error handling
4. **Resource Management**: Clean up resources in cleanup()
5. **Security Awareness**: Follow security guidelines

### Security

1. **Principle of Least Privilege**: Request minimal permissions
2. **Input Validation**: Validate all inputs
3. **Resource Limits**: Set appropriate limits
4. **Error Handling**: Don't expose sensitive information
5. **Regular Updates**: Keep dependencies updated

### Performance

1. **Lazy Loading**: Load resources only when needed
2. **Caching**: Cache expensive operations
3. **Async Operations**: Use async/await properly
4. **Memory Management**: Avoid memory leaks
5. **Monitoring**: Track performance metrics

## Troubleshooting

### Common Issues

1. **Plugin Not Loading**: Check file permissions and syntax
2. **Configuration Errors**: Validate against schema
3. **Security Violations**: Review security policies
4. **Resource Limits**: Adjust limits as needed
5. **Dependency Issues**: Verify plugin dependencies

### Debug Mode

Enable debug logging:

```typescript
process.env.DEBUG = "plugin:*";
const profileManager = new EnhancedProfileManager();
```

### Health Monitoring

Monitor plugin health:

```typescript
setInterval(async () => {
    const health = await profileManager.getPluginSystemStatus();
    console.log("Plugin system health:", health);
}, 60000); // Every minute
```

## Future Enhancements

### Planned Features

1. **Plugin Marketplace**: Centralized plugin distribution
2. **Version Management**: Semantic versioning and updates
3. **Dependency Resolution**: Automatic dependency management
4. **Performance Profiling**: Built-in performance analysis
5. **Hot Swapping**: Live plugin replacement

### Extension Points

1. **Custom Sandboxes**: Pluggable sandbox implementations
2. **Security Policies**: Custom security rule engines
3. **Resource Monitors**: Custom resource tracking
4. **Event Handlers**: Additional event types
5. **Configuration Sources**: External configuration providers

## Conclusion

The plugin-style profile system provides a robust, secure, and extensible foundation for dynamically managing AI profiles in the ACP integration. It maintains backward compatibility while enabling powerful new capabilities for customization and extension.

The system is designed with security, performance, and ease of use in mind, providing comprehensive tooling for both plugin developers and system administrators.
