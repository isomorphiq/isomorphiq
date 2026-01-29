import { EventEmitter } from "node:events";

/**
 * Distributed coordination primitives for multi-instance scenarios
 * Provides distributed locks, leader election, and coordination mechanisms
 */

export interface DistributedLockOptions {
    timeout?: number; // Lock timeout in milliseconds
    retryInterval?: number; // Retry interval in milliseconds
    maxRetries?: number; // Maximum retry attempts
    autoRelease?: boolean; // Auto-release on process exit
}

export interface LockInfo {
    lockId: string;
    holderId: string;
    acquiredAt: number;
    expiresAt: number;
    resource: string;
}

export class DistributedLockError extends Error {
    constructor(
        message: string,
        public readonly code: "TIMEOUT" | "HELD" | "EXPIRED" | "RELEASED"
    ) {
        super(message);
        this.name = "DistributedLockError";
    }
}

/**
 * Distributed lock implementation using storage backend
 */
export class DistributedLock extends EventEmitter {
    private isHeld = false;
    private lockInfo: LockInfo | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private retryTimeout: NodeJS.Timeout | null = null;

    constructor(
        private resource: string,
        private holderId: string,
        private storage: DistributedLockStorage,
        private options: DistributedLockOptions = {}
    ) {
        super();
        
        if (options.autoRelease !== false) {
            process.on('exit', () => this.release());
            process.on('SIGINT', () => this.release());
            process.on('SIGTERM', () => this.release());
        }
    }

    /**
     * Acquire the lock
     */
    async acquire(): Promise<void> {
        if (this.isHeld) {
            throw new DistributedLockError("Lock is already held", "HELD");
        }

        const timeout = this.options.timeout || 30000;
        const retryInterval = this.options.retryInterval || 1000;
        const maxRetries = this.options.maxRetries || Math.floor(timeout / retryInterval);

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const lockInfo: LockInfo = {
                    lockId: `lock_${this.resource}_${Date.now()}_${Math.random()}`,
                    holderId: this.holderId,
                    acquiredAt: Date.now(),
                    expiresAt: Date.now() + timeout,
                    resource: this.resource
                };

                // Try to acquire lock
                const acquired = await this.storage.acquireLock(lockInfo);
                if (acquired) {
                    this.lockInfo = lockInfo;
                    this.isHeld = true;
                    
                    // Start heartbeat to maintain lock
                    this.startHeartbeat();
                    
                    this.emit("acquired", lockInfo);
                    return;
                }

                // Lock is held by someone else, wait and retry
                if (attempt < maxRetries) {
                    await new Promise(resolve => {
                        this.retryTimeout = setTimeout(resolve, retryInterval);
                    });
                }

            } catch (error) {
                this.emit("error", error);
                throw error;
            }
        }

        throw new DistributedLockError(`Failed to acquire lock after ${maxRetries} attempts`, "TIMEOUT");
    }

    /**
     * Release the lock
     */
    async release(): Promise<void> {
        if (!this.isHeld || !this.lockInfo) {
            return; // Lock not held
        }

        try {
            await this.storage.releaseLock(this.lockInfo);
        } catch (error) {
            this.emit("error", error);
        } finally {
            this.cleanup();
            this.isHeld = false;
            this.lockInfo = null;
            this.emit("released");
        }
    }

    /**
     * Check if lock is held
     */
    isLockHeld(): boolean {
        return this.isHeld;
    }

    /**
     * Get lock information
     */
    getLockInfo(): LockInfo | null {
        return this.lockInfo;
    }

    /**
     * Start heartbeat to maintain lock
     */
    private startHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(async () => {
            if (this.isHeld && this.lockInfo) {
                try {
                    await this.storage.extendLock(this.lockInfo);
                    this.emit("heartbeat", this.lockInfo);
                } catch (error) {
                    this.emit("error", error);
                    this.cleanup();
                    this.isHeld = false;
                    this.lockInfo = null;
                    this.emit("lost", error);
                }
            }
        }, 5000); // Heartbeat every 5 seconds
    }

    /**
     * Cleanup timers and intervals
     */
    private cleanup(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.retryTimeout) {
            clearTimeout(this.retryTimeout);
            this.retryTimeout = null;
        }
    }
}

/**
 * Storage interface for distributed locks
 */
export interface DistributedLockStorage {
    acquireLock(lockInfo: LockInfo): Promise<boolean>;
    releaseLock(lockInfo: LockInfo): Promise<void>;
    extendLock(lockInfo: LockInfo): Promise<void>;
    getLock(resource: string): Promise<LockInfo | null>;
}

/**
 * In-memory implementation of distributed lock storage (for testing)
 */
export class InMemoryLockStorage implements DistributedLockStorage {
    private locks = new Map<string, LockInfo>();
    private cleanupInterval: NodeJS.Timeout;

    constructor() {
        // Clean up expired locks every 10 seconds
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredLocks();
        }, 10000);
    }

    async acquireLock(lockInfo: LockInfo): Promise<boolean> {
        const existing = this.locks.get(lockInfo.resource);
        
        // Check if lock is expired
        if (existing && existing.expiresAt > Date.now()) {
            return false; // Lock is held and not expired
        }

        // Acquire lock
        this.locks.set(lockInfo.resource, lockInfo);
        return true;
    }

    async releaseLock(lockInfo: LockInfo): Promise<void> {
        const existing = this.locks.get(lockInfo.resource);
        
        if (existing && existing.lockId === lockInfo.lockId) {
            this.locks.delete(lockInfo.resource);
        }
    }

    async extendLock(lockInfo: LockInfo): Promise<void> {
        const existing = this.locks.get(lockInfo.resource);
        
        if (existing && existing.lockId === lockInfo.lockId) {
            const timeout = 30000; // Default 30 seconds
            this.locks.set(lockInfo.resource, {
                ...existing,
                expiresAt: Date.now() + timeout
            });
        } else {
            throw new DistributedLockError("Lock not found or held by another holder", "RELEASED");
        }
    }

    async getLock(resource: string): Promise<LockInfo | null> {
        const lock = this.locks.get(resource);
        
        if (lock && lock.expiresAt > Date.now()) {
            return lock;
        }
        
        return null;
    }

    private cleanupExpiredLocks(): void {
        const now = Date.now();
        
        for (const [resource, lock] of this.locks.entries()) {
            if (lock.expiresAt <= now) {
                this.locks.delete(resource);
            }
        }
    }

    close(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}

/**
 * Leader election implementation
 */
export interface LeaderElectionOptions {
    electionTimeout?: number; // Election timeout in milliseconds
    heartbeatInterval?: number; // Leader heartbeat interval
    leaseDuration?: number; // Leader lease duration
}

export interface ElectionState {
    term: number;
    leaderId: string | null;
    votedFor: string | null;
    lastHeartbeat: number;
}

export class LeaderElection extends EventEmitter {
    private state: ElectionState;
    private isCandidate = false;
    private isLeader = false;
    private heartbeatTimeout: NodeJS.Timeout | null = null;
    private electionTimeout: NodeJS.Timeout | null = null;

    constructor(
        private nodeId: string,
        private storage: LeaderElectionStorage,
        private allNodes: string[],
        private options: LeaderElectionOptions = {}
    ) {
        super();
        
        this.state = {
            term: 0,
            leaderId: null,
            votedFor: null,
            lastHeartbeat: 0
        };

        // Start election process
        this.startElectionProcess();
    }

    private startElectionProcess(): void {
        this.scheduleElection();
    }

    private scheduleElection(): void {
        const timeout = this.options.electionTimeout || 15000;
        
        this.electionTimeout = setTimeout(() => {
            this.startElection();
        }, timeout + Math.random() * 5000); // Add randomness to prevent split brain
    }

    private async startElection(): Promise<void> {
        if (this.isLeader) {
            return; // Already leader
        }

        this.state.term++;
        this.state.votedFor = this.nodeId;

        this.emit("electionStarted", this.state.term);

        // Request votes from other nodes
        const votes = await this.requestVotes();
        
        if (this.hasMajority(votes)) {
            // Become leader
            this.becomeLeader();
        } else {
            // Lost election, go back to follower
            this.scheduleElection();
        }
    }

    private async requestVotes(): Promise<string[]> {
        const votes: string[] = [];
        
        // Vote for self
        votes.push(this.nodeId);

        // Request votes from other nodes (simplified implementation)
        for (const nodeId of this.allNodes) {
            if (nodeId !== this.nodeId) {
                try {
                    const granted = await this.storage.requestVote(
                        nodeId,
                        this.state.term,
                        this.nodeId
                    );
                    
                    if (granted) {
                        votes.push(nodeId);
                    }
                } catch (error) {
                    this.emit("error", error);
                }
            }
        }

        return votes;
    }

    private hasMajority(votes: string[]): boolean {
        return votes.length > Math.floor(this.allNodes.length / 2);
    }

    private becomeLeader(): void {
        this.isLeader = true;
        this.isCandidate = false;
        this.state.leaderId = this.nodeId;
        
        this.emit("elected", this.state.term);
        
        // Start heartbeat
        this.startHeartbeat();
    }

    private startHeartbeat(): void {
        if (this.heartbeatTimeout) {
            clearInterval(this.heartbeatTimeout);
        }

        const interval = this.options.heartbeatInterval || 5000;
        
        this.heartbeatTimeout = setInterval(async () => {
            try {
                await this.storage.sendHeartbeat(this.nodeId, this.state.term);
                this.state.lastHeartbeat = Date.now();
                this.emit("heartbeat", this.state.term);
            } catch (error) {
                this.emit("error", error);
                this.stepDown();
            }
        }, interval);
    }

    private stepDown(): void {
        if (this.heartbeatTimeout) {
            clearInterval(this.heartbeatTimeout);
            this.heartbeatTimeout = null;
        }

        this.isLeader = false;
        this.state.leaderId = null;
        
        this.emit("steppedDown", this.state.term);
        this.scheduleElection();
    }

    /**
     * Get current leader
     */
    async getLeader(): Promise<string | null> {
        try {
            const leader = await this.storage.getCurrentLeader();
            this.state.leaderId = leader;
            return leader;
        } catch (error) {
            this.emit("error", error);
            return null;
        }
    }

    /**
     * Check if current node is leader
     */
    isCurrentLeader(): boolean {
        return this.isLeader;
    }

    /**
     * Get current state
     */
    getState(): ElectionState {
        return { ...this.state };
    }

    /**
     * Stop election process
     */
    stop(): void {
        if (this.heartbeatTimeout) {
            clearInterval(this.heartbeatTimeout);
        }
        if (this.electionTimeout) {
            clearTimeout(this.electionTimeout);
        }
        this.stepDown();
    }
}

/**
 * Storage interface for leader election
 */
export interface LeaderElectionStorage {
    requestVote(nodeId: string, term: number, candidateId: string): Promise<boolean>;
    sendHeartbeat(leaderId: string, term: number): Promise<void>;
    getCurrentLeader(): Promise<string | null>;
}

/**
 * In-memory implementation of leader election storage (for testing)
 */
export class InMemoryLeaderElectionStorage implements LeaderElectionStorage {
    private state: Map<string, { term: number; lastHeartbeat: number }> = new Map();

    async requestVote(nodeId: string, term: number, candidateId: string): Promise<boolean> {
        const nodeState = this.state.get(nodeId);
        
        if (!nodeState || term > nodeState.term) {
            // Grant vote
            this.state.set(nodeId, {
                term,
                lastHeartbeat: Date.now()
            });
            return true;
        }
        
        // Suppress unused parameter warning
        void candidateId;
        
        return false;
    }

    async sendHeartbeat(leaderId: string, term: number): Promise<void> {
        this.state.set(leaderId, {
            term,
            lastHeartbeat: Date.now()
        });
    }

    async getCurrentLeader(): Promise<string | null> {
        let currentLeader: string | null = null;
        let latestTerm = -1;
        let latestHeartbeat = 0;

        for (const [nodeId, state] of this.state.entries()) {
            if (state.term > latestTerm || 
                (state.term === latestTerm && state.lastHeartbeat > latestHeartbeat)) {
                currentLeader = nodeId;
                latestTerm = state.term;
                latestHeartbeat = state.lastHeartbeat;
            }
        }

        return currentLeader;
    }
}

/**
 * Distributed semaphore implementation
 */
export class DistributedSemaphore {
    private waiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

    constructor(
        private resource: string,
        permits: number,
        private storage: DistributedSemaphoreStorage
    ) {
        // Suppress unused parameter warning
        void permits;
    }

    async acquire(): Promise<void> {
        try {
            const acquired = await this.storage.acquirePermit(this.resource);
            
            if (acquired) {
                return;
            }

            // Wait for permit to become available
            return new Promise((resolve, reject) => {
                this.waiters.push({ resolve, reject });
            });
        } catch (error) {
            throw new Error(`Failed to acquire semaphore permit: ${error}`);
        }
    }

    async release(): Promise<void> {
        try {
            await this.storage.releasePermit(this.resource);
            
            // Notify next waiter
            if (this.waiters.length > 0) {
                const waiter = this.waiters.shift();
                if (waiter) {
                    waiter.resolve();
                }
            }
        } catch (error) {
            throw new Error(`Failed to release semaphore permit: ${error}`);
        }
    }

    getAvailablePermits(): Promise<number> {
        return this.storage.getAvailablePermits(this.resource);
    }
}

/**
 * Storage interface for distributed semaphore
 */
export interface DistributedSemaphoreStorage {
    acquirePermit(resource: string): Promise<boolean>;
    releasePermit(resource: string): Promise<void>;
    getAvailablePermits(resource: string): Promise<number>;
}

/**
 * In-memory implementation of distributed semaphore storage (for testing)
 */
export class InMemorySemaphoreStorage implements DistributedSemaphoreStorage {
    private permits = new Map<string, number>();
    private maxPermits: Map<string, number>;

    constructor(maxPermits: Map<string, number>) {
        this.maxPermits = maxPermits;
        // Initialize permits
        for (const [resource, count] of maxPermits.entries()) {
            this.permits.set(resource, count);
        }
    }

    async acquirePermit(resource: string): Promise<boolean> {
        const available = this.permits.get(resource) || 0;
        
        if (available > 0) {
            this.permits.set(resource, available - 1);
            return true;
        }
        
        return false;
    }

    async releasePermit(resource: string): Promise<void> {
        const current = this.permits.get(resource) || 0;
        const maxPermits = this.maxPermits.get(resource) || 0;
        
        if (current < maxPermits) {
            this.permits.set(resource, current + 1);
        }
    }

    async getAvailablePermits(resource: string): Promise<number> {
        return this.permits.get(resource) || 0;
    }
}
