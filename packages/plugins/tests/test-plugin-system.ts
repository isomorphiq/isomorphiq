import { PluginManager } from "../src/plugin-manager.ts";
import { PluginSecurityManager } from "../src/plugin-sandbox.ts";
import { BaseProfilePlugin } from "../src/plugin-system.ts";
import type { ACPProfile } from "@isomorphiq/user-profile";
import fs from "fs/promises";
import path from "path";

/**
 * Test plugin for testing purposes
 */
class TestPlugin extends BaseProfilePlugin {
    constructor(name: string = "test-plugin") {
        super({
            name,
            version: "1.0.0",
            description: "Test plugin for plugin system testing",
            author: "Test Suite",
            license: "MIT",
            keywords: ["test"],
            dependencies: []
        }, undefined, {
            enabled: true,
            priority: 50,
            settings: { testMode: true }
        });
    }
    
    getProfile(): ACPProfile {
        return {
            name: this.metadata.name,
            role: "Test Profile",
            principalType: "agent",
            capabilities: ["testing"],
            maxConcurrentTasks: 1,
            priority: 50,
            color: "#ff0000",
            icon: "🧪",
            systemPrompt: "You are a test profile.",
            getTaskPrompt: (context: any) => `Test task: ${context.task?.title || "No task"}`
        };
    }
}

/**
 * Comprehensive test suite for plugin system
 */
class PluginSystemTester {
    private pluginManager: PluginManager;
    private securityManager: PluginSecurityManager;
    private testResults: Array<{ test: string; passed: boolean; error?: string }> = [];
    
    constructor() {
        this.pluginManager = new PluginManager(
            path.join(__dirname, "test-plugins"),
            path.join(__dirname, "test-config", "plugins.json")
        );
        this.securityManager = new PluginSecurityManager();
    }
    
    async runAllTests(): Promise<void> {
        console.log("🧪 Starting Plugin System Tests...\n");
        
        // Basic plugin functionality tests
        await this.testPluginCreation();
        await this.testPluginRegistration();
        await this.testPluginConfiguration();
        await this.testPluginLifecycle();
        
        // Plugin manager tests
        await this.testPluginManagerBasics();
        await this.testPluginDiscovery();
        await this.testPluginHotReload();
        
        // Security tests
        await this.testSandboxCreation();
        await this.testSecurityValidation();
        await this.testResourceLimits();
        
        // Integration tests
        await this.testPluginIntegration();
        await this.testErrorHandling();
        
        // Print results
        this.printResults();
    }
    
    private async testPluginCreation(): Promise<void> {
        try {
            const plugin = new TestPlugin();
            
            this.assert(
                plugin.metadata.name === "test-plugin",
                "Plugin metadata should be set correctly"
            );
            
            this.assert(
                typeof plugin.getProfile === "function",
                "Plugin should have getProfile method"
            );
            
            const profile = plugin.getProfile();
            this.assert(
                profile.name === "test-plugin",
                "Profile should have correct name"
            );
            
            this.assert(
                Array.isArray(profile.capabilities),
                "Profile should have capabilities array"
            );
            
            this.pass("Plugin Creation");
        } catch (error) {
            this.fail("Plugin Creation", error as Error);
        }
    }
    
    private async testPluginRegistration(): Promise<void> {
        try {
            const plugin = new TestPlugin("registration-test");
            
            await this.pluginManager.registerPlugin(plugin);
            
            const retrieved = this.pluginManager.getPlugin("registration-test");
            this.assert(
                retrieved !== undefined,
                "Plugin should be retrievable after registration"
            );
            
            this.assert(
                retrieved?.metadata.name === "registration-test",
                "Retrieved plugin should have correct name"
            );
            
            const allPlugins = this.pluginManager.getAllPlugins();
            this.assert(
                allPlugins.length >= 1,
                "Should have at least one registered plugin"
            );
            
            this.pass("Plugin Registration");
        } catch (error) {
            this.fail("Plugin Registration", error as Error);
        }
    }
    
    private async testPluginConfiguration(): Promise<void> {
        try {
            const plugin = new TestPlugin("config-test");
            
            // Test default config
            const defaultConfig = plugin.defaultConfig;
            this.assert(
                defaultConfig.enabled === true,
                "Default config should have enabled=true"
            );
            
            this.assert(
                typeof defaultConfig.priority === "number",
                "Default config should have priority number"
            );
            
            // Test config validation
            const validConfig = {
                enabled: true,
                priority: 75,
                settings: { testMode: false }
            };
            
            this.assert(
                plugin.validateConfig(validConfig),
                "Valid config should pass validation"
            );
            
            const invalidConfig = { enabled: "not-boolean" };
            this.assert(
                !plugin.validateConfig(invalidConfig),
                "Invalid config should fail validation"
            );
            
            this.pass("Plugin Configuration");
        } catch (error) {
            this.fail("Plugin Configuration", error as Error);
        }
    }
    
    private async testPluginLifecycle(): Promise<void> {
        try {
            const plugin = new TestPlugin("lifecycle-test");
            
            // Test initialization
            this.assert(
                plugin.state === "unloaded",
                "Plugin should start in unloaded state"
            );
            
            await plugin.initialize();
            this.assert(
                plugin.state === "active",
                "Plugin should be active after initialization"
            );
            
            // Test cleanup
            await plugin.cleanup();
            this.assert(
                plugin.state === "unloaded",
                "Plugin should be unloaded after cleanup"
            );
            
            this.pass("Plugin Lifecycle");
        } catch (error) {
            this.fail("Plugin Lifecycle", error as Error);
        }
    }
    
    private async testPluginManagerBasics(): Promise<void> {
        try {
            const plugin = new TestPlugin("manager-test");
            
            // Test registration
            await this.pluginManager.registerPlugin(plugin);
            
            // Test active plugins
            const activePlugins = this.pluginManager.getActivePlugins();
            this.assert(
                activePlugins.length >= 1,
                "Should have at least one active plugin"
            );
            
            // Test enable/disable
            await this.pluginManager.setPluginEnabled("manager-test", false);
            let retrieved = this.pluginManager.getPlugin("manager-test");
            this.assert(
                retrieved?.state === "loaded",
                "Plugin should be loaded but not active when disabled"
            );
            
            await this.pluginManager.setPluginEnabled("manager-test", true);
            retrieved = this.pluginManager.getPlugin("manager-test");
            this.assert(
                retrieved?.state === "active",
                "Plugin should be active when enabled"
            );
            
            // Test unregistration
            await this.pluginManager.unregisterPlugin("manager-test");
            const afterUnreg = this.pluginManager.getPlugin("manager-test");
            this.assert(
                afterUnreg === undefined,
                "Plugin should not exist after unregistration"
            );
            
            this.pass("Plugin Manager Basics");
        } catch (error) {
            this.fail("Plugin Manager Basics", error as Error);
        }
    }
    
    private async testPluginDiscovery(): Promise<void> {
        try {
            // Create a temporary plugin directory with test plugins
            const testDir = path.join(__dirname, "test-plugins");
            await fs.mkdir(testDir, { recursive: true });
            
            // Create a simple test plugin file
            const testPluginContent = `
import { BaseProfilePlugin } from "../../src/plugin-system.ts";
import type { ACPProfile } from "@isomorphiq/user-profile";

export default class DiscoveryTestPlugin extends BaseProfilePlugin {
    constructor() {
        super({
            name: "discovery-test",
            version: "1.0.0",
            description: "Plugin for testing discovery",
            author: "Test",
            license: "MIT",
            keywords: ["test"]
        });
    }
    
    getProfile(): ACPProfile {
        return {
            name: "discovery-test",
            role: "Test",
            principalType: "agent",
            capabilities: ["test"],
            maxConcurrentTasks: 1,
            priority: 50,
            color: "#00ff00",
            icon: "🔍",
            systemPrompt: "Test",
            getTaskPrompt: () => "Test"
        };
    }
}`;
            
            await fs.writeFile(
                path.join(testDir, "discovery-test-plugin.ts"),
                testPluginContent
            );
            
            // Test discovery
            await this.pluginManager.loadPluginsFromDirectory(testDir);
            
            const discovered = this.pluginManager.getPlugin("discovery-test");
            this.assert(
                discovered !== undefined,
                "Should discover and load plugin from directory"
            );
            
            // Cleanup
            await fs.rm(testDir, { recursive: true, force: true });
            
            this.pass("Plugin Discovery");
        } catch (error) {
            this.fail("Plugin Discovery", error as Error);
        }
    }
    
    private async testPluginHotReload(): Promise<void> {
        try {
            const plugin = new TestPlugin("reload-test");
            await this.pluginManager.registerPlugin(plugin);
            
            // Test reload
            await this.pluginManager.reloadPlugin("reload-test");
            
            const reloaded = this.pluginManager.getPlugin("reload-test");
            this.assert(
                reloaded !== undefined,
                "Plugin should exist after reload"
            );
            
            this.assert(
                reloaded?.state === "active",
                "Plugin should be active after reload"
            );
            
            this.pass("Plugin Hot Reload");
        } catch (error) {
            this.fail("Plugin Hot Reload", error as Error);
        }
    }
    
    private async testSandboxCreation(): Promise<void> {
        try {
            const plugin = new TestPlugin("sandbox-test");
            
            const sandbox = this.securityManager.createSandbox(plugin);
            
            this.assert(
                sandbox !== undefined,
                "Sandbox should be created successfully"
            );
            
            this.assert(
                sandbox.plugin.metadata.name === "sandbox-test",
                "Sandbox should reference correct plugin"
            );
            
            // Test method execution
            const result = await sandbox.executeMethod("getProfile");
            this.assert(
                result !== undefined,
                "Should be able to execute plugin methods through sandbox"
            );
            
            this.pass("Sandbox Creation");
        } catch (error) {
            this.fail("Sandbox Creation", error as Error);
        }
    }
    
    private async testSecurityValidation(): Promise<void> {
        try {
            const plugin = new TestPlugin("security-test");
            const sandbox = this.securityManager.createSandbox(plugin);
            
            // Test valid config
            const validConfig = {
                enabled: true,
                priority: 50,
                settings: { safeSetting: true }
            };
            
            const validResult = sandbox.validateConfig(validConfig);
            this.assert(
                validResult.valid,
                "Valid config should pass security validation"
            );
            
            // Test invalid config with dangerous settings
            const invalidConfig = {
                enabled: true,
                priority: 50,
                settings: {
                    eval: "dangerous",
                    child_process: "also-dangerous"
                }
            };
            
            const invalidResult = sandbox.validateConfig(invalidConfig);
            this.assert(
                !invalidResult.valid,
                "Config with dangerous settings should fail validation"
            );
            
            this.assert(
                invalidResult.violations.length > 0,
                "Should have security violations for dangerous config"
            );
            
            this.pass("Security Validation");
        } catch (error) {
            this.fail("Security Validation", error as Error);
        }
    }
    
    private async testResourceLimits(): Promise<void> {
        try {
            const plugin = new TestPlugin("resource-test");
            
            const sandbox = this.securityManager.createSandbox(plugin, {
                maxMemory: 1024 * 1024, // 1MB
                maxCpuTime: 5000 // 5 seconds
            });
            
            const usage = sandbox.getResourceUsage();
            
            this.assert(
                usage.memory.limit === 1024 * 1024,
                "Memory limit should be set correctly"
            );
            
            this.assert(
                usage.cpuTime.limit === 5000,
                "CPU time limit should be set correctly"
            );
            
            this.pass("Resource Limits");
        } catch (error) {
            this.fail("Resource Limits", error as Error);
        }
    }
    
    private async testPluginIntegration(): Promise<void> {
        try {
            const plugin = new TestPlugin("integration-test");
            await this.pluginManager.registerPlugin(plugin);
            
            // Test getting plugin profiles
            const profiles = this.pluginManager.getPluginProfiles();
            this.assert(
                profiles.length >= 1,
                "Should have at least one plugin profile"
            );
            
            // Test capability-based filtering
            const testPlugins = this.pluginManager.getPluginsByCapability("testing");
            this.assert(
                testPlugins.length >= 1,
                "Should find plugins by capability"
            );
            
            // Test health checking
            const health = await this.pluginManager.checkPluginHealth("integration-test");
            this.assert(
                health.status === "healthy",
                "Plugin should be healthy"
            );
            
            this.pass("Plugin Integration");
        } catch (error) {
            this.fail("Plugin Integration", error as Error);
        }
    }
    
    private async testErrorHandling(): Promise<void> {
        try {
            // Test getting non-existent plugin
            const nonExistent = this.pluginManager.getPlugin("does-not-exist");
            this.assert(
                nonExistent === undefined,
                "Should return undefined for non-existent plugin"
            );
            
            // Test invalid plugin operations
            try {
                await this.pluginManager.unregisterPlugin("does-not-exist");
                this.assert(false, "Should throw error for unregistering non-existent plugin");
            } catch (error) {
                this.assert(true, "Should throw error for unregistering non-existent plugin");
            }
            
            // Test plugin error state
            const errorPlugin = new TestPlugin("error-test");
            errorPlugin.state = "error";
            errorPlugin.error = new Error("Test error");
            
            await this.pluginManager.registerPlugin(errorPlugin);
            const health = await this.pluginManager.checkPluginHealth("error-test");
            this.assert(
                health.status === "unhealthy",
                "Plugin in error state should be unhealthy"
            );
            
            this.pass("Error Handling");
        } catch (error) {
            this.fail("Error Handling", error as Error);
        }
    }
    
    private assert(condition: boolean, message: string): void {
        if (!condition) {
            throw new Error(`Assertion failed: ${message}`);
        }
    }
    
    private pass(testName: string): void {
        this.testResults.push({ test: testName, passed: true });
        console.log(`✅ ${testName}`);
    }
    
    private fail(testName: string, error: Error): void {
        this.testResults.push({ 
            test: testName, 
            passed: false, 
            error: error.message 
        });
        console.log(`❌ ${testName}: ${error.message}`);
    }
    
    private printResults(): void {
        console.log("\n📊 Test Results:");
        console.log("================");
        
        const passed = this.testResults.filter(r => r.passed).length;
        const failed = this.testResults.filter(r => !r.passed).length;
        const total = this.testResults.length;
        
        console.log(`Total: ${total}, Passed: ${passed}, Failed: ${failed}`);
        console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
        
        if (failed > 0) {
            console.log("\n❌ Failed Tests:");
            this.testResults
                .filter(r => !r.passed)
                .forEach(r => {
                    console.log(`  - ${r.test}: ${r.error}`);
                });
        }
        
        console.log("\n🎉 Plugin System Testing Complete!");
    }
    
    async cleanup(): Promise<void> {
        await this.pluginManager.shutdown();
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    const tester = new PluginSystemTester();
    
    try {
        await tester.runAllTests();
    } catch (error) {
        console.error("Test suite failed:", error);
        process.exit(1);
    } finally {
        await tester.cleanup();
    }
}

export { PluginSystemTester };
