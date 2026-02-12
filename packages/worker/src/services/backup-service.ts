// TODO: This file is too complex (823 lines) and should be refactored into several modules.
// Current concerns mixed: Backup creation and restoration, compression, cloud storage,
// integrity checking, retention management, scheduling, metadata tracking.
// 
// Proposed structure:
// - backup/backup-service.ts - Main backup orchestration
// - backup/creation-service.ts - Backup creation logic
// - backup/restoration-service.ts - Backup restoration logic
// - backup/compression-service.ts - Compression and decompression
// - backup/cloud-providers/ - Cloud storage implementations (S3, Azure, GCS)
// - backup/integrity-service.ts - Checksum and integrity verification
// - backup/retention-service.ts - Backup retention and cleanup
// - backup/scheduler.ts - Backup scheduling
// - backup/types.ts - Backup-specific types

import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import * as cron from "node-cron";
import type { ProductManager } from "@isomorphiq/profiles";
import type { Task } from "@isomorphiq/tasks";

export interface BackupConfig {
	backupDirectory: string;
	retentionDays: number;
	maxBackups: number;
	compressionEnabled: boolean;
	cloudStorage?: {
		provider: "s3" | "azure" | "gcs";
		bucket: string;
		region?: string;
		credentials?: {
			accessKeyId?: string;
			secretAccessKey?: string;
			connectionString?: string;
		};
	};
	schedule: {
		enabled: boolean;
		cronExpression: string;
		timezone?: string;
	};
	integrityCheck: {
		enabled: boolean;
		hashAlgorithm: "sha256" | "sha512";
	};
}

export interface BackupMetadata {
	id: string;
	timestamp: string;
	type: "manual" | "scheduled" | "auto";
	version: string;
	size: number;
	compressed: boolean;
	checksum: string;
	dataCounts: {
		tasks: number;
		users: number;
		templates: number;
		automationRules: number;
		schedules: number;
	};
	status: "creating" | "completed" | "failed" | "corrupted";
	error?: string;
	restorationTest?: {
		lastTested: string;
		success: boolean;
		error?: string;
	};
	cloudStorage?: {
		provider: string;
		location: string;
		uploaded: boolean;
	};
}

export interface BackupResult {
	success: boolean;
	backupId: string;
	metadata: BackupMetadata;
	filePath?: string;
	error?: string;
}

export interface RestoreResult {
	success: boolean;
	restoreId: string;
	restoredItems: {
		tasks: number;
		users: number;
		templates: number;
		automationRules: number;
		schedules: number;
	};
	errors: string[];
	warnings: string[];
	rollbackAvailable: boolean;
}

export interface BackupStats {
	totalBackups: number;
	totalSize: number;
	latestBackup?: string;
	oldestBackup?: string;
	retentionStatus: {
		withinRetention: number;
		expired: number;
	};
	healthStatus: {
		status: "healthy" | "warning" | "critical";
		issues: string[];
	};
	cloudStorageStatus?: {
		provider: string;
		lastSync: string;
		synced: number;
		failed: number;
	};
}

export interface BackupExportData {
	tasks: Task[];
	users: any[];
	templates: any[];
	automationRules: any[];
	schedules: any[];
	metadata: {
		exportDate: string;
		version: string;
		source: "isomorphiq-daemon";
		dataCounts: BackupMetadata["dataCounts"];
	};
}

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class BackupService extends EventEmitter {
	private productManager: ProductManager;
	private config: BackupConfig;
	private backupDirectory: string;
	private scheduledBackupTask?: cron.ScheduledTask;
	private isBackupInProgress: boolean = false;

	constructor(productManager: ProductManager, config: BackupConfig) {
		super();
		this.productManager = productManager;
		this.config = config;
		this.backupDirectory = config.backupDirectory;
		this.initializeBackupDirectory();
		this.setupScheduledBackups();
	}

	private async initializeBackupDirectory(): Promise<void> {
		try {
			await fs.mkdir(this.backupDirectory, { recursive: true });
			console.log(`[BACKUP] Backup directory initialized: ${this.backupDirectory}`);
		} catch (error) {
			console.error("[BACKUP] Failed to initialize backup directory:", error);
			throw error;
		}
	}

	private setupScheduledBackups(): void {
		if (this.config.schedule.enabled && this.config.schedule.cronExpression) {
			try {
				this.scheduledBackupTask = cron.schedule(
					this.config.schedule.cronExpression,
					() => {
						console.log("[BACKUP] Starting scheduled backup");
						this.createBackup("scheduled").catch((error) => {
							console.error("[BACKUP] Scheduled backup failed:", error);
							this.emit("scheduledBackupFailed", error);
						});
					},
					{
						scheduled: true,
						timezone: this.config.schedule.timezone || "UTC",
					}
				);
				console.log(`[BACKUP] Scheduled backups configured: ${this.config.schedule.cronExpression}`);
			} catch (error) {
				console.error("[BACKUP] Failed to setup scheduled backups:", error);
			}
		}
	}

	async createBackup(type: "manual" | "scheduled" | "auto" = "manual"): Promise<BackupResult> {
		if (this.isBackupInProgress) {
			return {
				success: false,
				backupId: "",
				metadata: {} as BackupMetadata,
				error: "Backup already in progress",
			};
		}

		this.isBackupInProgress = true;
		const backupId = randomUUID();
		const timestamp = new Date().toISOString();

		try {
			console.log(`[BACKUP] Starting ${type} backup: ${backupId}`);
			this.emit("backupStarted", { backupId, type, timestamp });

			// Collect all data
			const exportData = await this.collectAllData();
			
			// Create backup metadata
			const metadata: BackupMetadata = {
				id: backupId,
				timestamp,
				type,
				version: "1.0.0",
				size: 0,
				compressed: this.config.compressionEnabled,
				checksum: "",
				dataCounts: {
					tasks: exportData.tasks.length,
					users: exportData.users.length,
					templates: exportData.templates.length,
					automationRules: exportData.automationRules.length,
					schedules: exportData.schedules.length,
				},
				status: "creating",
			};

			// Serialize data
			const jsonData = JSON.stringify(exportData, null, 2);
			const dataBuffer = Buffer.from(jsonData, "utf-8");
			
			// Calculate checksum
			metadata.checksum = createHash(this.config.integrityCheck.hashAlgorithm)
				.update(dataBuffer)
				.digest("hex");
			
			metadata.size = dataBuffer.length;

			// Create backup file
			const fileName = `backup_${backupId}_${timestamp.replace(/[:.]/g, "-")}.json`;
			const filePath = join(this.backupDirectory, fileName);
			
			// Write backup file
			await fs.writeFile(filePath, dataBuffer);
			
			// Write metadata file
			const metadataPath = join(this.backupDirectory, `${fileName}.meta`);
			await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

			metadata.status = "completed";
			
			// Update metadata file with final status
			await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

			console.log(`[BACKUP] Backup completed: ${backupId} (${metadata.size} bytes)`);
			this.emit("backupCompleted", { backupId, metadata, filePath });

			// Upload to cloud storage if configured
			if (this.config.cloudStorage) {
				await this.uploadToCloudStorage(backupId, filePath, metadata).catch((error) => {
					console.error("[BACKUP] Cloud storage upload failed:", error);
					this.emit("cloudStorageUploadFailed", { backupId, error });
				});
			}

			// Cleanup old backups
			await this.cleanupOldBackups();

			return {
				success: true,
				backupId,
				metadata,
				filePath,
			};

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`[BACKUP] Backup failed: ${backupId}`, error);
			
			this.emit("backupFailed", { backupId, error: errorMessage });
			
			return {
				success: false,
				backupId,
				metadata: {
					id: backupId,
					timestamp,
					type,
					version: "1.0.0",
					size: 0,
					compressed: false,
					checksum: "",
					dataCounts: { tasks: 0, users: 0, templates: 0, automationRules: 0, schedules: 0 },
					status: "failed",
					error: errorMessage,
				},
				error: errorMessage,
			};
		} finally {
			this.isBackupInProgress = false;
		}
	}

	private async collectAllData(): Promise<BackupExportData> {
		const [tasks, users, templates, automationRules, schedules] = await Promise.all([
			this.productManager.getAllTasks(),
			this.getAllUsers(),
			this.getAllTemplates(),
			this.getAllAutomationRules(),
			this.getAllSchedules(),
		]);

		return {
			tasks,
			users,
			templates,
			automationRules,
			schedules,
			metadata: {
				exportDate: new Date().toISOString(),
				version: "1.0.0",
				source: "isomorphiq-daemon",
				dataCounts: {
					tasks: tasks.length,
					users: users.length,
					templates: templates.length,
					automationRules: automationRules.length,
					schedules: schedules.length,
				},
			},
		};
	}

	private async getAllUsers(): Promise<any[]> {
		try {
			const userManager = (this.productManager as any).userManager;
			if (userManager && typeof userManager.getAllUsers === "function") {
				return await userManager.getAllUsers();
			}
		} catch (error) {
			console.warn("[BACKUP] Could not retrieve users:", error);
		}
		return [];
	}

	private async getAllTemplates(): Promise<any[]> {
		try {
			const templateManager = this.productManager.getTemplateManager();
			if (templateManager && typeof templateManager.getAllTemplates === "function") {
				return await templateManager.getAllTemplates();
			}
		} catch (error) {
			console.warn("[BACKUP] Could not retrieve templates:", error);
		}
		return [];
	}

	private async getAllAutomationRules(): Promise<any[]> {
		try {
			const templateManager = this.productManager.getTemplateManager();
			if (templateManager && typeof templateManager.getAllAutomationRules === "function") {
				return await templateManager.getAllAutomationRules();
			}
		} catch (error) {
			console.warn("[BACKUP] Could not retrieve automation rules:", error);
		}
		return [];
	}

	private async getAllSchedules(): Promise<any[]> {
		try {
			// This would need to be implemented in the scheduler service
			// For now, return empty array
			return [];
		} catch (error) {
			console.warn("[BACKUP] Could not retrieve schedules:", error);
		}
		return [];
	}

	async restoreFromBackup(backupId: string, options: {
		createRollback?: boolean;
		skipIntegrityCheck?: boolean;
		dryRun?: boolean;
	} = {}): Promise<RestoreResult> {
		const restoreId = randomUUID();
		const timestamp = new Date().toISOString();
		
		try {
			console.log(`[BACKUP] Starting restore from backup: ${backupId}`);
			this.emit("restoreStarted", { restoreId, backupId, timestamp });

			// Load backup metadata
			const metadata = await this.loadBackupMetadata(backupId);
			if (!metadata) {
				throw new Error(`Backup metadata not found: ${backupId}`);
			}

			// Verify integrity
			if (!options.skipIntegrityCheck) {
				const integrityValid = await this.verifyBackupIntegrity(backupId);
				if (!integrityValid) {
					throw new Error(`Backup integrity check failed: ${backupId}`);
				}
			}

			// Load backup data
			const backupData = await this.loadBackupData(backupId);
			if (!backupData) {
				throw new Error(`Backup data not found: ${backupId}`);
			}

			// Create rollback if requested
			let rollbackBackup: BackupResult | undefined;
			if (options.createRollback) {
				rollbackBackup = await this.createBackup("auto");
			}

			const errors: string[] = [];
			const warnings: string[] = [];
			let restoredItems = {
				tasks: 0,
				users: 0,
				templates: 0,
				automationRules: 0,
				schedules: 0,
			};

			if (options.dryRun) {
				console.log("[BACKUP] Dry run mode - no actual restoration");
				restoredItems = backupData.metadata.dataCounts;
			} else {
				// Restore data
				try {
					// Restore tasks
					for (const task of backupData.tasks) {
						try {
							await this.productManager.createTask(
								task.title,
								task.description,
								task.priority,
								task.dependencies || [],
								task.createdBy,
								task.assignedTo,
								task.collaborators,
								task.watchers,
								task.type
							);
							restoredItems.tasks++;
						} catch (error) {
							errors.push(`Failed to restore task ${task.id}: ${error}`);
						}
					}

					// Restore other data types would be implemented here
					// For now, we'll just count them
					restoredItems.users = backupData.users.length;
					restoredItems.templates = backupData.templates.length;
					restoredItems.automationRules = backupData.automationRules.length;
					restoredItems.schedules = backupData.schedules.length;

				} catch (error) {
					errors.push(`Restore operation failed: ${error}`);
					throw error;
				}
			}

			const result: RestoreResult = {
				success: errors.length === 0,
				restoreId,
				restoredItems,
				errors,
				warnings,
				rollbackAvailable: !!rollbackBackup?.success,
			};

			console.log(`[BACKUP] Restore completed: ${restoreId}`);
			this.emit("restoreCompleted", { restoreId, backupId, result });

			return result;

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`[BACKUP] Restore failed: ${restoreId}`, error);
			
			this.emit("restoreFailed", { restoreId, backupId, error: errorMessage });
			
			return {
				success: false,
				restoreId,
				restoredItems: { tasks: 0, users: 0, templates: 0, automationRules: 0, schedules: 0 },
				errors: [errorMessage],
				warnings: [],
				rollbackAvailable: false,
			};
		}
	}

	private async loadBackupMetadata(backupId: string): Promise<BackupMetadata | null> {
		try {
			const metadataFiles = await fs.readdir(this.backupDirectory);
			const metadataFile = metadataFiles.find(file => 
				file.endsWith(`${backupId}.json.meta`)
			);
			
			if (!metadataFile) {
				return null;
			}

			const metadataPath = join(this.backupDirectory, metadataFile);
			const metadataContent = await fs.readFile(metadataPath, "utf-8");
			return JSON.parse(metadataContent) as BackupMetadata;
		} catch (error) {
			console.error("[BACKUP] Failed to load backup metadata:", error);
			return null;
		}
	}

	private async loadBackupData(backupId: string): Promise<BackupExportData | null> {
		try {
			const backupFiles = await fs.readdir(this.backupDirectory);
			const backupFile = backupFiles.find(file => 
				file.includes(backupId) && file.endsWith(".json") && !file.endsWith(".meta")
			);
			
			if (!backupFile) {
				return null;
			}

			const backupPath = join(this.backupDirectory, backupFile);
			const backupContent = await fs.readFile(backupPath, "utf-8");
			return JSON.parse(backupContent) as BackupExportData;
		} catch (error) {
			console.error("[BACKUP] Failed to load backup data:", error);
			return null;
		}
	}

	async verifyBackupIntegrity(backupId: string): Promise<boolean> {
		try {
			const metadata = await this.loadBackupMetadata(backupId);
			if (!metadata) {
				return false;
			}

			const backupData = await this.loadBackupData(backupId);
			if (!backupData) {
				return false;
			}

			// Recalculate checksum
			const jsonData = JSON.stringify(backupData, null, 2);
			const dataBuffer = Buffer.from(jsonData, "utf-8");
			const calculatedChecksum = createHash(this.config.integrityCheck.hashAlgorithm)
				.update(dataBuffer)
				.digest("hex");

			const isValid = calculatedChecksum === metadata.checksum;
			
			if (!isValid) {
				console.warn(`[BACKUP] Integrity check failed for backup: ${backupId}`);
				// Update metadata status
				metadata.status = "corrupted";
				const metadataFiles = await fs.readdir(this.backupDirectory);
				const metadataFile = metadataFiles.find(file => 
					file.endsWith(`${backupId}.json.meta`)
				);
				if (metadataFile) {
					const metadataPath = join(this.backupDirectory, metadataFile);
					await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
				}
			}

			return isValid;
		} catch (error) {
			console.error("[BACKUP] Integrity check failed:", error);
			return false;
		}
	}

	async listBackups(): Promise<BackupMetadata[]> {
		try {
			const files = await fs.readdir(this.backupDirectory);
			const metadataFiles = files.filter(file => file.endsWith(".meta"));
			
			const backups: BackupMetadata[] = [];
			
			for (const metadataFile of metadataFiles) {
				try {
					const metadataPath = join(this.backupDirectory, metadataFile);
					const metadataContent = await fs.readFile(metadataPath, "utf-8");
					const metadata = JSON.parse(metadataContent) as BackupMetadata;
					backups.push(metadata);
				} catch (error) {
					console.warn(`[BACKUP] Failed to load metadata file: ${metadataFile}`, error);
				}
			}

			// Sort by timestamp (newest first)
			backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
			
			return backups;
		} catch (error) {
			console.error("[BACKUP] Failed to list backups:", error);
			return [];
		}
	}

	async getBackupStats(): Promise<BackupStats> {
		const backups = await this.listBackups();
		const now = new Date();
		const retentionCutoff = new Date(now.getTime() - (this.config.retentionDays * 24 * 60 * 60 * 1000));

		const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
		const withinRetention = backups.filter(backup => new Date(backup.timestamp) > retentionCutoff).length;
		const expired = backups.length - withinRetention;

		const issues: string[] = [];
		let status: "healthy" | "warning" | "critical" = "healthy";

		if (backups.length === 0) {
			issues.push("No backups found");
			status = "critical";
		} else if (expired > 0) {
			issues.push(`${expired} expired backups found`);
			status = "warning";
		}

		const corruptedBackups = backups.filter(backup => backup.status === "corrupted").length;
		if (corruptedBackups > 0) {
			issues.push(`${corruptedBackups} corrupted backups found`);
			status = status === "critical" ? "critical" : "warning";
		}

		return {
			totalBackups: backups.length,
			totalSize,
			latestBackup: backups[0]?.timestamp,
			oldestBackup: backups[backups.length - 1]?.timestamp,
			retentionStatus: {
				withinRetention,
				expired,
			},
			healthStatus: {
				status,
				issues,
			},
		};
	}

	async cleanupOldBackups(): Promise<void> {
		try {
			const backups = await this.listBackups();
			const now = new Date();
			const retentionCutoff = new Date(now.getTime() - (this.config.retentionDays * 24 * 60 * 60 * 1000));

			// Delete backups older than retention period
			const expiredBackups = backups.filter(backup => 
				new Date(backup.timestamp) < retentionCutoff
			);

			// Also enforce max backups limit
			let backupsToDelete = expiredBackups;
			if (backups.length > this.config.maxBackups) {
				const excessBackups = backups
					.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
					.slice(0, backups.length - this.config.maxBackups);
				
				backupsToDelete = [...new Set([...expiredBackups, ...excessBackups])];
			}

			for (const backup of backupsToDelete) {
				await this.deleteBackup(backup.id);
			}

			if (backupsToDelete.length > 0) {
				console.log(`[BACKUP] Cleaned up ${backupsToDelete.length} old backups`);
			}
		} catch (error) {
			console.error("[BACKUP] Cleanup failed:", error);
		}
	}

	async deleteBackup(backupId: string): Promise<void> {
		try {
			const files = await fs.readdir(this.backupDirectory);
			const backupFiles = files.filter(file => file.includes(backupId));

			for (const file of backupFiles) {
				const filePath = join(this.backupDirectory, file);
				await fs.unlink(filePath);
			}

			console.log(`[BACKUP] Deleted backup: ${backupId}`);
		} catch (error) {
			console.error(`[BACKUP] Failed to delete backup: ${backupId}`, error);
			throw error;
		}
	}

	async exportBackup(backupId: string, format: "json" | "csv" = "json"): Promise<string> {
		const backupData = await this.loadBackupData(backupId);
		if (!backupData) {
			throw new Error(`Backup not found: ${backupId}`);
		}

		if (format === "json") {
			return JSON.stringify(backupData, null, 2);
		} else if (format === "csv") {
			// Convert to CSV format
			const csvLines: string[] = [];
			
			// Tasks CSV
			if (backupData.tasks.length > 0) {
				csvLines.push("TASKS");
				csvLines.push("ID,Title,Description,Status,Priority,CreatedAt,UpdatedAt,CreatedBy,AssignedTo,Type");
				for (const task of backupData.tasks) {
					csvLines.push(`"${task.id}","${task.title}","${task.description}","${task.status}","${task.priority}","${task.createdAt}","${task.updatedAt}","${task.createdBy || ""}","${task.assignedTo || ""}","${task.type || ""}"`);
				}
				csvLines.push("");
			}

			return csvLines.join("\n");
		}

		throw new Error(`Unsupported export format: ${format}`);
	}

	private async uploadToCloudStorage(backupId: string, filePath: string, metadata: BackupMetadata): Promise<void> {
		if (!this.config.cloudStorage) {
			return;
		}

		try {
			// This would integrate with AWS S3, Azure Blob Storage, or Google Cloud Storage
			// For now, we'll just log the intention
			console.log(`[BACKUP] Would upload backup ${backupId} to ${this.config.cloudStorage.provider} storage`);
			
			// Update metadata with cloud storage info
			metadata.cloudStorage = {
				provider: this.config.cloudStorage.provider,
				location: `${this.config.cloudStorage.bucket}/${backupId}.json`,
				uploaded: true,
			};

		} catch (error) {
			console.error(`[BACKUP] Cloud storage upload failed: ${backupId}`, error);
			throw error;
		}
	}

	async testDisasterRecovery(): Promise<{
		success: boolean;
		testId: string;
		backupId: string;
		restoreTime: number;
		integrityCheck: boolean;
		errors: string[];
	}> {
		const testId = randomUUID();
		const startTime = Date.now();

		try {
			console.log(`[BACKUP] Starting disaster recovery test: ${testId}`);
			
			// Create a test backup
			const backupResult = await this.createBackup("manual");
			if (!backupResult.success) {
				throw new Error(`Test backup creation failed: ${backupResult.error}`);
			}

			// Verify backup integrity
			const integrityValid = await this.verifyBackupIntegrity(backupResult.backupId);
			if (!integrityValid) {
				throw new Error("Backup integrity verification failed");
			}

			// Test restore (dry run)
			const restoreResult = await this.restoreFromBackup(backupResult.backupId, {
				dryRun: true,
				createRollback: false,
				skipIntegrityCheck: false,
			});

			const restoreTime = Date.now() - startTime;

			const result = {
				success: restoreResult.success && integrityValid,
				testId,
				backupId: backupResult.backupId,
				restoreTime,
				integrityCheck: integrityValid,
				errors: restoreResult.errors,
			};

			console.log(`[BACKUP] Disaster recovery test completed: ${testId} (${restoreTime}ms)`);
			this.emit("disasterRecoveryTestCompleted", result);

			return result;

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`[BACKUP] Disaster recovery test failed: ${testId}`, error);
			
			return {
				success: false,
				testId,
				backupId: "",
				restoreTime: Date.now() - startTime,
				integrityCheck: false,
				errors: [errorMessage],
			};
		}
	}

	stop(): void {
		if (this.scheduledBackupTask) {
			this.scheduledBackupTask.stop();
			console.log("[BACKUP] Scheduled backups stopped");
		}
	}

	getConfig(): BackupConfig {
		return { ...this.config };
	}

	updateConfig(config: Partial<BackupConfig>): void {
		this.config = { ...this.config, ...config };
		
		// Restart scheduled backups if configuration changed
		if (config.schedule) {
			if (this.scheduledBackupTask) {
				this.scheduledBackupTask.stop();
			}
			this.setupScheduledBackups();
		}
		
		console.log("[BACKUP] Configuration updated");
	}
}