// TODO: This file is too complex (679 lines) and should be refactored into several modules.
// Current concerns mixed: Configuration profiles, validation, history tracking,
// environment-specific settings, performance expectations, use case management.
// 
// Proposed structure:
// - task-3/config/index.ts - Main configuration manager
// - task-3/config/profile-service.ts - Configuration profile management
// - task-3/config/validator.ts - Configuration validation logic
// - task-3/config/history-service.ts - Configuration change tracking
// - task-3/config/environment-service.ts - Environment-specific configuration
// - task-3/config/performance-service.ts - Performance expectation management
// - task-3/config/types.ts - Configuration-specific types

// Configuration Management System for Mixed Base 3 Operations - Task b7c2d592-load

import type {
    MixedOperationConfig,
    ErrorRecoveryConfig,
    TaskFilterOptions,
    ContentionScenario,
    PerformanceBaseline
} from "./types.ts";

export interface ConfigurationProfile {
    name: string;
    description: string;
    config: MixedOperationConfig;
    errorRecovery: ErrorRecoveryConfig;
    useCases: string[];
    expectedPerformance: {
        minSuccessRate: number;
        maxAverageDuration: number;
        minThroughput: number;
    };
}

export interface ConfigurationValidation {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class ConfigurationManager {
    private profiles: Map<string, ConfigurationProfile> = new Map();
    private activeProfile: string | null = null;
    private configHistory: Array<{
        profile: string;
        timestamp: Date;
        change: string;
    }> = [];

    constructor() {
        this.initializeDefaultProfiles();
    }

    /**
     * Initialize default configuration profiles for different scenarios
     */
    private initializeDefaultProfiles(): void {
        // Development Profile - Low concurrency, high visibility
        const devProfile: ConfigurationProfile = {
            name: "development",
            description: "Development environment with low concurrency and detailed logging",
            config: {
                concurrentOperations: 5,
                operationMix: {
                    creates: 20,
                    reads: 50,
                    updates: 25,
                    deletes: 5
                },
                resourceContention: false,
                errorRecovery: true,
                timingConfig: {
                    minDelay: 10,
                    maxDelay: 50,
                    contentionMultiplier: 1.0
                }
            },
            errorRecovery: {
                maxRetries: 3,
                baseDelay: 100,
                maxDelay: 1000,
                backoffMultiplier: 2,
                retryableErrors: ['contention', 'timeout', 'connection'],
                circuitBreakerThreshold: 5,
                circuitBreakerTimeout: 30000
            },
            useCases: ["development", "testing", "debugging"],
            expectedPerformance: {
                minSuccessRate: 0.95,
                maxAverageDuration: 100,
                minThroughput: 10
            }
        };

        // Load Testing Profile - High concurrency, stress testing
        const loadTestProfile: ConfigurationProfile = {
            name: "load-testing",
            description: "High-load testing with maximum concurrency and contention",
            config: {
                concurrentOperations: 50,
                operationMix: {
                    creates: 30,
                    reads: 30,
                    updates: 30,
                    deletes: 10
                },
                resourceContention: true,
                errorRecovery: true,
                timingConfig: {
                    minDelay: 20,
                    maxDelay: 200,
                    contentionMultiplier: 2.0
                }
            },
            errorRecovery: {
                maxRetries: 5,
                baseDelay: 50,
                maxDelay: 2000,
                backoffMultiplier: 1.5,
                retryableErrors: ['contention', 'timeout', 'connection', 'resource'],
                circuitBreakerThreshold: 10,
                circuitBreakerTimeout: 60000
            },
            useCases: ["load testing", "stress testing", "performance benchmarking"],
            expectedPerformance: {
                minSuccessRate: 0.85,
                maxAverageDuration: 500,
                minThroughput: 25
            }
        };

        // Production Profile - Balanced performance and reliability
        const prodProfile: ConfigurationProfile = {
            name: "production",
            description: "Production environment with balanced performance and reliability",
            config: {
                concurrentOperations: 20,
                operationMix: {
                    creates: 25,
                    reads: 40,
                    updates: 30,
                    deletes: 5
                },
                resourceContention: true,
                errorRecovery: true,
                timingConfig: {
                    minDelay: 30,
                    maxDelay: 150,
                    contentionMultiplier: 1.5
                }
            },
            errorRecovery: {
                maxRetries: 3,
                baseDelay: 100,
                maxDelay: 1500,
                backoffMultiplier: 2,
                retryableErrors: ['contention', 'timeout', 'connection'],
                circuitBreakerThreshold: 7,
                circuitBreakerTimeout: 45000
            },
            useCases: ["production", "staging", "performance critical"],
            expectedPerformance: {
                minSuccessRate: 0.92,
                maxAverageDuration: 250,
                minThroughput: 40
            }
        };

        // Read-Heavy Profile - Optimized for read operations
        const readHeavyProfile: ConfigurationProfile = {
            name: "read-heavy",
            description: "Read-optimized configuration for analytics and reporting",
            config: {
                concurrentOperations: 30,
                operationMix: {
                    creates: 5,
                    reads: 85,
                    updates: 8,
                    deletes: 2
                },
                resourceContention: false,
                errorRecovery: true,
                timingConfig: {
                    minDelay: 10,
                    maxDelay: 80,
                    contentionMultiplier: 1.2
                }
            },
            errorRecovery: {
                maxRetries: 2,
                baseDelay: 75,
                maxDelay: 800,
                backoffMultiplier: 1.8,
                retryableErrors: ['timeout', 'connection'],
                circuitBreakerThreshold: 4,
                circuitBreakerTimeout: 20000
            },
            useCases: ["analytics", "reporting", "data export"],
            expectedPerformance: {
                minSuccessRate: 0.98,
                maxAverageDuration: 80,
                minThroughput: 60
            }
        };

        // Write-Heavy Profile - Optimized for write operations
        const writeHeavyProfile: ConfigurationProfile = {
            name: "write-heavy",
            description: "Write-optimized configuration for bulk data processing",
            config: {
                concurrentOperations: 15,
                operationMix: {
                    creates: 45,
                    reads: 10,
                    updates: 40,
                    deletes: 5
                },
                resourceContention: true,
                errorRecovery: true,
                timingConfig: {
                    minDelay: 50,
                    maxDelay: 250,
                    contentionMultiplier: 2.5
                }
            },
            errorRecovery: {
                maxRetries: 4,
                baseDelay: 150,
                maxDelay: 3000,
                backoffMultiplier: 1.5,
                retryableErrors: ['contention', 'timeout', 'connection', 'resource', 'lock'],
                circuitBreakerThreshold: 8,
                circuitBreakerTimeout: 60000
            },
            useCases: ["bulk data import", "data migration", "batch processing"],
            expectedPerformance: {
                minSuccessRate: 0.88,
                maxAverageDuration: 400,
                minThroughput: 20
            }
        };

        this.profiles.set("development", devProfile);
        this.profiles.set("load-testing", loadTestProfile);
        this.profiles.set("production", prodProfile);
        this.profiles.set("read-heavy", readHeavyProfile);
        this.profiles.set("write-heavy", writeHeavyProfile);

        // Set default active profile
        this.activeProfile = "development";
    }

    /**
     * Get all available configuration profiles
     */
    getProfiles(): Map<string, ConfigurationProfile> {
        return new Map(this.profiles);
    }

    /**
     * Get a specific configuration profile
     */
    getProfile(name: string): ConfigurationProfile | null {
        return this.profiles.get(name) || null;
    }

    /**
     * Get the currently active configuration profile
     */
    getActiveProfile(): ConfigurationProfile | null {
        return this.activeProfile ? this.profiles.get(this.activeProfile) || null : null;
    }

    /**
     * Set the active configuration profile
     */
    setActiveProfile(name: string): boolean {
        const profile = this.profiles.get(name);
        if (profile) {
            const previousProfile = this.activeProfile;
            this.activeProfile = name;
            
            // Record the change
            this.configHistory.push({
                profile: name,
                timestamp: new Date(),
                change: `Switched from ${previousProfile} to ${name}`
            });
            
            return true;
        }
        return false;
    }

    /**
     * Create a custom configuration profile
     */
    createProfile(profile: ConfigurationProfile): ConfigurationValidation {
        const validation = this.validateProfile(profile);
        
        if (validation.isValid) {
            // Check for existing profile with same name
            if (this.profiles.has(profile.name)) {
                validation.warnings.push(`Profile '${profile.name}' already exists and will be overwritten`);
            }
            
            this.profiles.set(profile.name, profile);
            
            // Record the change
            this.configHistory.push({
                profile: profile.name,
                timestamp: new Date(),
                change: `Created/updated profile '${profile.name}'`
            });
        }
        
        return validation;
    }

    /**
     * Update an existing configuration profile
     */
    updateProfile(name: string, updates: Partial<ConfigurationProfile>): boolean {
        const existingProfile = this.profiles.get(name);
        if (!existingProfile) {
            return false;
        }

        const updatedProfile: ConfigurationProfile = {
            ...existingProfile,
            ...updates,
            name // Ensure name doesn't change
        };

        const validation = this.validateProfile(updatedProfile);
        if (validation.isValid) {
            this.profiles.set(name, updatedProfile);
            
            // Record the change
            this.configHistory.push({
                profile: name,
                timestamp: new Date(),
                change: `Updated profile '${name}'`
            });
            
            return true;
        }

        return false;
    }

    /**
     * Delete a configuration profile
     */
    deleteProfile(name: string): boolean {
        if (this.profiles.has(name) && this.activeProfile !== name) {
            this.profiles.delete(name);
            
            // Record the change
            this.configHistory.push({
                profile: name,
                timestamp: new Date(),
                change: `Deleted profile '${name}'`
            });
            
            return true;
        }
        return false;
    }

    /**
     * Validate a configuration profile
     */
    validateProfile(profile: ConfigurationProfile): ConfigurationValidation {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate basic structure
        if (!profile.name || profile.name.trim().length === 0) {
            errors.push("Profile name is required");
        }

        if (!profile.description || profile.description.trim().length === 0) {
            errors.push("Profile description is required");
        }

        // Validate config
        const configValidation = this.validateMixedOperationConfig(profile.config);
        if (!configValidation.isValid) {
            errors.push(...configValidation.errors);
        }
        warnings.push(...configValidation.warnings);

        // Validate error recovery config
        const errorRecoveryValidation = this.validateErrorRecoveryConfig(profile.errorRecovery);
        if (!errorRecoveryValidation.isValid) {
            errors.push(...errorRecoveryValidation.errors);
        }
        warnings.push(...errorRecoveryValidation.warnings);

        // Validate expected performance
        if (profile.expectedPerformance.minSuccessRate < 0 || profile.expectedPerformance.minSuccessRate > 1) {
            errors.push("Minimum success rate must be between 0 and 1");
        }

        if (profile.expectedPerformance.maxAverageDuration <= 0) {
            errors.push("Maximum average duration must be positive");
        }

        if (profile.expectedPerformance.minThroughput <= 0) {
            errors.push("Minimum throughput must be positive");
        }

        // Performance warnings
        if (profile.expectedPerformance.minSuccessRate < 0.8) {
            warnings.push("Low minimum success rate may indicate unrealistic expectations");
        }

        if (profile.expectedPerformance.maxAverageDuration > 1000) {
            warnings.push("High maximum average duration may impact user experience");
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate mixed operation configuration
     */
    private validateMixedOperationConfig(config: MixedOperationConfig): ConfigurationValidation {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate concurrent operations
        if (!Number.isInteger(config.concurrentOperations) || config.concurrentOperations < 1) {
            errors.push("Concurrent operations must be a positive integer");
        }

        if (config.concurrentOperations > 100) {
            warnings.push("High concurrent operations may overwhelm the system");
        }

        // Validate operation mix
        const total = config.operationMix.creates + 
                     config.operationMix.reads + 
                     config.operationMix.updates + 
                     config.operationMix.deletes;

        if (Math.abs(total - 100) > 0.01) {
            errors.push(`Operation mix must sum to 100%, got ${total}%`);
        }

        // Validate individual operation percentages
        Object.entries(config.operationMix).forEach(([operation, value]) => {
            if (value < 0 || value > 100) {
                errors.push(`${operation} percentage must be between 0 and 100`);
            }
        });

        // Validate timing config
        if (config.timingConfig.minDelay >= config.timingConfig.maxDelay) {
            errors.push("Minimum delay must be less than maximum delay");
        }

        if (config.timingConfig.minDelay < 0 || config.timingConfig.maxDelay < 0) {
            errors.push("Delay values must be positive");
        }

        if (config.timingConfig.contentionMultiplier < 1) {
            warnings.push("Contention multiplier less than 1 may reduce contention effects");
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate error recovery configuration
     */
    private validateErrorRecoveryConfig(config: ErrorRecoveryConfig): ConfigurationValidation {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (config.maxRetries < 0) {
            errors.push("Max retries cannot be negative");
        }

        if (config.maxRetries > 10) {
            warnings.push("High max retries may delay error detection");
        }

        if (config.baseDelay >= config.maxDelay) {
            errors.push("Base delay must be less than max delay");
        }

        if (config.backoffMultiplier <= 1) {
            warnings.push("Backoff multiplier <= 1 may cause thundering herd");
        }

        if (config.circuitBreakerThreshold < 0) {
            errors.push("Circuit breaker threshold cannot be negative");
        }

        if (config.circuitBreakerTimeout <= 0) {
            errors.push("Circuit breaker timeout must be positive");
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Get configuration history
     */
    getConfigHistory(limit?: number): Array<{
        profile: string;
        timestamp: Date;
        change: string;
    }> {
        if (limit) {
            return this.configHistory.slice(-limit);
        }
        return [...this.configHistory];
    }

    /**
     * Export configuration to JSON
     */
    exportProfiles(): string {
        const exportData = {
            version: "1.0.0",
            timestamp: new Date().toISOString(),
            activeProfile: this.activeProfile,
            profiles: Object.fromEntries(this.profiles),
            configHistory: this.configHistory
        };
        
        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Import configuration from JSON
     */
    importProfiles(jsonData: string): ConfigurationValidation {
        try {
            const importData = JSON.parse(jsonData);
            
            if (!importData.profiles) {
                return {
                    isValid: false,
                    errors: ["Invalid import data format"],
                    warnings: []
                };
            }

            const errors: string[] = [];
            const warnings: string[] = [];

            // Validate each profile
            Object.entries(importData.profiles).forEach(([name, profileData]: [string, any]) => {
                const profile = profileData as ConfigurationProfile;
                const validation = this.validateProfile(profile);
                
                if (!validation.isValid) {
                    errors.push(`Profile '${name}': ${validation.errors.join(', ')}`);
                }
                
                warnings.push(`Profile '${name}': ${validation.warnings.join(', ')}`);
            });

            if (errors.length === 0) {
                // Import all profiles
                Object.entries(importData.profiles).forEach(([name, profileData]) => {
                    const profile = profileData as ConfigurationProfile;
                    this.profiles.set(name, profile);
                });

                // Set active profile if specified
                if (importData.activeProfile && this.profiles.has(importData.activeProfile)) {
                    this.setActiveProfile(importData.activeProfile);
                }

                // Record the import
                this.configHistory.push({
                    profile: "import",
                    timestamp: new Date(),
                    change: `Imported ${Object.keys(importData.profiles).length} profiles`
                });
            }

            return {
                isValid: errors.length === 0,
                errors,
                warnings
            };

        } catch (error) {
            return {
                isValid: false,
                errors: [`JSON parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`],
                warnings: []
            };
        }
    }

    /**
     * Get recommended profile for specific use case
     */
    getRecommendedProfile(useCase: string): ConfigurationProfile | null {
        const recommendations: Record<string, string> = {
            "development": "development",
            "testing": "development",
            "load-testing": "load-testing",
            "stress-testing": "load-testing",
            "performance": "load-testing",
            "production": "production",
            "staging": "production",
            "analytics": "read-heavy",
            "reporting": "read-heavy",
            "export": "read-heavy",
            "import": "write-heavy",
            "migration": "write-heavy",
            "batch": "write-heavy"
        };

        const profileName = recommendations[useCase.toLowerCase()];
        return profileName ? this.getProfile(profileName) : this.getActiveProfile();
    }

    /**
     * Compare two profiles and return differences
     */
    compareProfiles(profile1: string, profile2: string): {
        config: Record<string, { before: any; after: any }>;
        errorRecovery: Record<string, { before: any; after: any }>;
        performance: Record<string, { before: any; after: any }>;
    } | null {
        const p1 = this.getProfile(profile1);
        const p2 = this.getProfile(profile2);

        if (!p1 || !p2) {
            return null;
        }

        const compare = (obj1: any, obj2: any, prefix = ""): Record<string, { before: any; after: any }> => {
            const differences: Record<string, { before: any; after: any }> = {};
            
            Object.keys(obj1).forEach(key => {
                const keyPath = prefix ? `${prefix}.${key}` : key;
                if (JSON.stringify(obj1[key]) !== JSON.stringify(obj2[key])) {
                    differences[keyPath] = {
                        before: obj1[key],
                        after: obj2[key]
                    };
                }
            });

            return differences;
        };

        return {
            config: compare(p1.config, p2.config, "config"),
            errorRecovery: compare(p1.errorRecovery, p2.errorRecovery, "errorRecovery"),
            performance: compare(p1.expectedPerformance, p2.expectedPerformance, "performance")
        };
    }

    /**
     * Reset to default configuration
     */
    resetToDefaults(): void {
        this.profiles.clear();
        this.configHistory = [];
        this.initializeDefaultProfiles();
        this.activeProfile = "development";
    }
}

// Export singleton instance
export const configurationManager = new ConfigurationManager();

export default configurationManager;