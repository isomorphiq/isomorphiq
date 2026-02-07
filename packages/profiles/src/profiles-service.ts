// FILE_CONTEXT: "context-98986b15-4dc3-497a-852b-cc24e854d112"

import { Level } from "level";
import { z } from "zod";
import {
    defaultDashboardPreferences,
    defaultUserPreferences,
    defaultUserProfileDetails,
    type PreferencesSyncMetadata,
    type UpsertUserProfileInput,
    type UserPreferencesExport,
    type UserPreferences,
    type UserProfileDetails,
    type UserProfileRecord,
    type UserProfileSeed,
    UserProfileRecordSchema,
    UserPreferencesExportSchema,
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

const mergeWidgetNotificationPreferences = (
    base: UserPreferences["dashboard"]["widgetNotifications"],
    updates: UserPreferences["dashboard"]["widgetNotifications"] | undefined,
): UserPreferences["dashboard"]["widgetNotifications"] => {
    const baseNotifications = base && typeof base === "object" ? base : {};
    const updateNotifications = updates && typeof updates === "object" ? updates : {};
    return Object.entries(updateNotifications).reduce(
        (acc, [widgetId, updateValue]) => {
            if (!widgetId) {
                return acc;
            }
            if (!updateValue || typeof updateValue !== "object") {
                return { ...acc, [widgetId]: updateValue };
            }
            const baseValue = baseNotifications[widgetId];
            const baseObject = baseValue && typeof baseValue === "object" ? baseValue : {};
            const baseTypes =
                baseObject.types && typeof baseObject.types === "object" ? baseObject.types : {};
            const updateTypes =
                updateValue.types && typeof updateValue.types === "object" ? updateValue.types : {};
            const mergedTypes = { ...baseTypes, ...updateTypes };
            const nextValue = {
                ...baseObject,
                ...updateValue,
                ...(Object.keys(mergedTypes).length > 0 ? { types: mergedTypes } : {}),
            };
            return { ...acc, [widgetId]: nextValue };
        },
        { ...baseNotifications },
    );
};

const mergePreferences = (
    base: UserPreferences,
    updates:
        | {
              theme?: UserPreferences["theme"];
              notifications?: Partial<UserPreferences["notifications"]>;
              dashboard?: Partial<UserPreferences["dashboard"]>;
          }
        | undefined,
): UserPreferences => {
    const dashboardUpdates = updates?.dashboard;
    return {
        ...base,
        ...(updates?.theme ? { theme: updates.theme } : {}),
        notifications: {
            ...base.notifications,
            ...(updates?.notifications ?? {}),
        },
        dashboard: {
            ...base.dashboard,
            ...(dashboardUpdates ?? {}),
            widgetNotifications: {
                ...mergeWidgetNotificationPreferences(
                    base.dashboard.widgetNotifications,
                    dashboardUpdates?.widgetNotifications,
                ),
            },
        },
    };
};

const resolvePreferencesUpdatedAt = (value: unknown, fallbackUpdatedAt: number): number => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        return value;
    }
    return fallbackUpdatedAt;
};

const resolvePreferencesSyncMetadata = (
    value: unknown,
    fallbackUpdatedAt: number,
): PreferencesSyncMetadata => {
    if (!value || typeof value !== "object") {
        return { updatedAt: fallbackUpdatedAt };
    }
    const record = Object.entries(value).reduce<Record<string, unknown>>(
        (acc, [key, entry]) => ({ ...acc, [key]: entry }),
        {},
    );
    const updatedAt = resolvePreferencesUpdatedAt(record.updatedAt, fallbackUpdatedAt);
    const deviceId =
        typeof record.deviceId === "string" && record.deviceId.trim().length > 0
            ? record.deviceId
            : undefined;
    const source =
        typeof record.source === "string" && record.source.trim().length > 0
            ? record.source
            : undefined;
    return {
        updatedAt,
        ...(deviceId ? { deviceId } : {}),
        ...(source ? { source } : {}),
    };
};

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
            preferencesSync: resolvePreferencesSyncMetadata(seed?.preferencesSync, 0),
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
            preferencesSync: input.preferencesSync,
        });
        const incomingPreferencesUpdatedAt = resolvePreferencesUpdatedAt(
            input.preferencesSync?.updatedAt,
            Date.now(),
        );
        const shouldApplyPreferences =
            Boolean(input.preferences)
            && incomingPreferencesUpdatedAt >= existing.preferencesSync.updatedAt;
        const nextPreferences = shouldApplyPreferences
            ? mergePreferences(existing.preferences, input.preferences)
            : existing.preferences;
        const nextPreferencesSync = shouldApplyPreferences
            ? resolvePreferencesSyncMetadata(input.preferencesSync, incomingPreferencesUpdatedAt)
            : existing.preferencesSync;
        const updated: UserProfileRecord = {
            ...existing,
            profile: mergeProfileDetails(existing.profile, input.profile),
            preferences: nextPreferences,
            preferencesSync: nextPreferencesSync,
            updatedAt: new Date(),
        };
        await this.db.put(input.userId, updated);
        return updated;
    }

    public async resetDashboardPreferences(userId: string): Promise<UserProfileRecord> {
        await this.ensureOpen();
        const existing = await this.getOrCreateProfile(userId);
        const nextPreferencesSync = resolvePreferencesSyncMetadata(
            existing.preferencesSync,
            Date.now(),
        );
        const updated: UserProfileRecord = {
            ...existing,
            preferences: {
                ...existing.preferences,
                dashboard: defaultDashboardPreferences(),
            },
            preferencesSync: {
                ...nextPreferencesSync,
                updatedAt: Date.now(),
            },
            updatedAt: new Date(),
        };
        await this.db.put(userId, updated);
        return updated;
    }

    public async exportPreferences(userId: string): Promise<UserPreferencesExport> {
        await this.ensureOpen();
        const existing = await this.getOrCreateProfile(userId);
        const exportPayload: UserPreferencesExport = UserPreferencesExportSchema.parse({
            version: 1,
            exportedAt: Date.now(),
            preferences: existing.preferences,
            preferencesSync: existing.preferencesSync,
        }) as UserPreferencesExport;
        return exportPayload;
    }

    public async importPreferences(
        userId: string,
        payload: UserPreferencesExport,
    ): Promise<UserProfileRecord> {
        await this.ensureOpen();
        const existing = await this.getOrCreateProfile(userId);
        const incomingUpdatedAt = resolvePreferencesUpdatedAt(
            payload.preferencesSync?.updatedAt,
            payload.exportedAt,
        );
        const shouldApply = incomingUpdatedAt >= existing.preferencesSync.updatedAt;
        const nextPreferences = shouldApply ? payload.preferences : existing.preferences;
        const nextPreferencesSync = shouldApply
            ? resolvePreferencesSyncMetadata(payload.preferencesSync, incomingUpdatedAt)
            : existing.preferencesSync;
        const updated: UserProfileRecord = {
            ...existing,
            preferences: nextPreferences,
            preferencesSync: nextPreferencesSync,
            updatedAt: new Date(),
        };
        await this.db.put(userId, updated);
        return updated;
    }
}
