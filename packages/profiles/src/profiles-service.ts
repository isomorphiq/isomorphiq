import { Level } from "level";
import { z } from "zod";
import {
    defaultUserPreferences,
    defaultUserProfileDetails,
    type UpsertUserProfileInput,
    type UserPreferences,
    type UserProfileDetails,
    type UserProfileRecord,
    type UserProfileSeed,
    UserProfileRecordSchema,
} from "./profiles-domain.ts";

const CoercedDateSchema = z.preprocess((value) => {
    if (value instanceof Date) {
        return value;
    }
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return value;
}, z.date());

const UserProfileRecordWireSchema = UserProfileRecordSchema.extend({
    createdAt: CoercedDateSchema,
    updatedAt: CoercedDateSchema,
});

const mergeProfileDetails = (
    base: UserProfileDetails,
    updates: Partial<UserProfileDetails> | undefined,
): UserProfileDetails => ({
    ...base,
    ...(updates ?? {}),
});

const mergePreferences = (
    base: UserPreferences,
    updates:
        | {
              theme?: UserPreferences["theme"];
              notifications?: Partial<UserPreferences["notifications"]>;
              dashboard?: Partial<UserPreferences["dashboard"]>;
          }
        | undefined,
): UserPreferences => ({
    ...base,
    ...(updates?.theme ? { theme: updates.theme } : {}),
    notifications: {
        ...base.notifications,
        ...(updates?.notifications ?? {}),
    },
    dashboard: {
        ...base.dashboard,
        ...(updates?.dashboard ?? {}),
    },
});

export class UserProfileService {
    private readonly db: Level<string, UserProfileRecord>;
    private dbReady = false;

    constructor(dbPath: string) {
        this.db = new Level<string, UserProfileRecord>(dbPath, {
            valueEncoding: "json",
        });
    }

    public async open(): Promise<void> {
        if (this.dbReady) {
            return;
        }
        await this.db.open();
        this.dbReady = true;
    }

    private async ensureOpen(): Promise<void> {
        if (!this.dbReady) {
            await this.open();
        }
    }

    private normalizeRecord(value: unknown): UserProfileRecord {
        return UserProfileRecordWireSchema.parse(value) as UserProfileRecord;
    }

    public async getProfile(userId: string): Promise<UserProfileRecord | null> {
        await this.ensureOpen();
        try {
            const value = await this.db.get(userId);
            return this.normalizeRecord(value);
        } catch {
            return null;
        }
    }

    private buildSeededRecord(userId: string, seed: UserProfileSeed | undefined): UserProfileRecord {
        const now = new Date();
        return {
            userId,
            profile: mergeProfileDetails(defaultUserProfileDetails(), seed?.profile),
            preferences: mergePreferences(defaultUserPreferences(), seed?.preferences),
            createdAt: now,
            updatedAt: now,
        };
    }

    public async getOrCreateProfile(
        userId: string,
        seed?: UserProfileSeed,
    ): Promise<UserProfileRecord> {
        const existing = await this.getProfile(userId);
        if (existing) {
            return existing;
        }

        const created = this.buildSeededRecord(userId, seed);
        await this.db.put(userId, created);
        return created;
    }

    public async upsertProfile(input: UpsertUserProfileInput): Promise<UserProfileRecord> {
        await this.ensureOpen();
        const existing = await this.getOrCreateProfile(input.userId, {
            profile: input.profile,
            preferences: input.preferences,
        });
        const updated: UserProfileRecord = {
            ...existing,
            profile: mergeProfileDetails(existing.profile, input.profile),
            preferences: mergePreferences(existing.preferences, input.preferences),
            updatedAt: new Date(),
        };
        await this.db.put(input.userId, updated);
        return updated;
    }
}
