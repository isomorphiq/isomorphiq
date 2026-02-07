import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { authAtom } from "../authAtoms.ts";
import { SectionCard } from "./SectionCard.tsx";

interface ProfileState {
    name: string;
    isActive: boolean;
    currentTasks: number;
    completedTasks: number;
    failedTasks: number;
    averageProcessingTime: number;
    lastActivity: string;
    queueSize: number;
    isProcessing: boolean;
}

interface ProfileMetrics {
    throughput: number;
    successRate: number;
    averageTaskDuration: number;
    queueWaitTime: number;
    errorRate: number;
}

interface ProfileData {
    profile: {
        name: string;
        role: string;
        runtimeName?: string;
        modelName?: string;
        capabilities: string[];
        maxConcurrentTasks: number;
        priority: number;
        color: string;
        icon: string;
    };
    state: ProfileState;
    metrics: ProfileMetrics;
}

interface AuthApiUser {
    id: string;
    username: string;
    email: string;
    role: string;
    profile?: {
        name?: string;
        bio?: string;
    };
}

interface UserProfileListItem {
    id: string;
    username: string;
    email: string;
    role: string;
    name?: string;
    bio?: string;
    isCurrentUser: boolean;
}

interface ProfileConfigurationSnapshot {
    name: string;
    defaults: {
        runtimeName?: string;
        modelName?: string;
        systemPrompt?: string;
        taskPromptPrefix?: string;
    };
    overrides: {
        runtimeName?: string;
        modelName?: string;
        systemPrompt?: string;
        taskPromptPrefix?: string;
    };
    effective: {
        runtimeName?: string;
        modelName?: string;
        systemPrompt?: string;
        taskPromptPrefix?: string;
    };
    updatedAt?: string;
}

interface ProfileConfigForm {
    runtimeName: "" | "codex" | "opencode";
    modelName: string;
    systemPrompt: string;
    taskPromptPrefix: string;
}

interface FlashMessage {
    type: "success" | "error";
    text: string;
}

const emptyForm: ProfileConfigForm = {
    runtimeName: "",
    modelName: "",
    systemPrompt: "",
    taskPromptPrefix: "",
};

const OPENCODE_MODEL_OPTIONS = [
    "lmstudio/nvidia/nemotron-3-nano",
    "lmstudio/openai/gpt-oss-20b",
    "lmstudio/qwen/qwen3-coder-next",
    "lmstudio/qwen/qwen3-vl-4b",
    "lmstudio/qwen3-4b-gemini-triplex-high-reasoning-thinking-heretic-uncensored",
];

const toFormFromOverrides = (snapshot: ProfileConfigurationSnapshot): ProfileConfigForm => {
    const runtimeOverride = snapshot.overrides.runtimeName;
    return {
        runtimeName:
            runtimeOverride === "codex" || runtimeOverride === "opencode"
                ? runtimeOverride
                : "",
        modelName: snapshot.overrides.modelName ?? "",
        systemPrompt: snapshot.overrides.systemPrompt ?? "",
        taskPromptPrefix: snapshot.overrides.taskPromptPrefix ?? "",
    };
};

const normalizeOptionalText = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
};

const formatLastActivity = (lastActivity: string): string => {
    const date = new Date(lastActivity);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
};

const formatTimestamp = (timestamp?: string): string => {
    if (!timestamp) {
        return "Never";
    }
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return "Unknown";
    }
    return date.toLocaleString();
};

const toUserProfileListItems = (
    users: AuthApiUser[],
    currentUserId: string | undefined,
): UserProfileListItem[] =>
    users.map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        name: user.profile?.name,
        bio: user.profile?.bio,
        isCurrentUser: user.id === currentUserId,
    }));

export function ProfileManagement() {
    const [auth, setAuth] = useAtom(authAtom);
    const navigate = useNavigate();
    const { profileName: routeProfileName } = useParams<{ profileName?: string }>();
    const [profiles, setProfiles] = useState<ProfileData[]>([]);
    const [userProfiles, setUserProfiles] = useState<UserProfileListItem[]>([]);
    const [configsByName, setConfigsByName] = useState<Record<string, ProfileConfigurationSnapshot>>(
        {},
    );
    const [form, setForm] = useState<ProfileConfigForm>(emptyForm);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [message, setMessage] = useState<FlashMessage | null>(null);
    const selectedProfileName = routeProfileName ?? null;

    const navigateToProfile = useCallback(
        (profileName: string, replace: boolean = false) => {
            navigate(`/profiles/${encodeURIComponent(profileName)}`, { replace });
        },
        [navigate],
    );

    const clearAuthAndRedirectToLogin = useCallback(() => {
        if (typeof window !== "undefined") {
            localStorage.removeItem("authToken");
            localStorage.removeItem("user");
        }
        setAuth({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
        });
        navigate("/login", { replace: true });
    }, [navigate, setAuth]);

    const buildAuthHeaders = useCallback((baseHeaders?: HeadersInit): Headers => {
        const headers = new Headers(baseHeaders ?? {});
        const token =
            auth.token
            ?? (typeof window !== "undefined" ? localStorage.getItem("authToken") : null);
        if (token && token.trim().length > 0) {
            headers.set("Authorization", `Bearer ${token}`);
        }
        return headers;
    }, [auth.token]);

    const authenticatedFetch = useCallback(
        async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const response = await fetch(input, {
                ...init,
                headers: buildAuthHeaders(init?.headers),
            });
            if (response.status === 401) {
                clearAuthAndRedirectToLogin();
                throw new Error("Authentication required. Please sign in again.");
            }
            return response;
        },
        [buildAuthHeaders, clearAuthAndRedirectToLogin],
    );

    const fetchProfiles = useCallback(async () => {
        const response = await authenticatedFetch("/api/profiles/with-states");
        if (!response.ok) {
            throw new Error(`Failed to fetch profiles (${response.status})`);
        }
        const data = (await response.json()) as ProfileData[];
        setProfiles(data);
        return data;
    }, [authenticatedFetch]);

    const fetchConfigs = useCallback(async () => {
        const response = await authenticatedFetch("/api/profiles/configs");
        if (!response.ok) {
            throw new Error(`Failed to fetch profile configs (${response.status})`);
        }
        const data = (await response.json()) as ProfileConfigurationSnapshot[];
        const nextMap = data.reduce<Record<string, ProfileConfigurationSnapshot>>(
            (acc, config) => ({
                ...acc,
                [config.name]: config,
            }),
            {},
        );
        setConfigsByName(nextMap);
        return nextMap;
    }, [authenticatedFetch]);

    const fetchSingleConfig = useCallback(async (profileName: string) => {
        const response = await authenticatedFetch(`/api/profiles/${encodeURIComponent(profileName)}/config`);
        if (!response.ok) {
            throw new Error(`Failed to fetch profile config (${response.status})`);
        }
        const snapshot = (await response.json()) as ProfileConfigurationSnapshot;
        setConfigsByName((current) => ({
            ...current,
            [snapshot.name]: snapshot,
        }));
        return snapshot;
    }, [authenticatedFetch]);

    const fetchUserProfiles = useCallback(async () => {
        if (!auth.token) {
            setUserProfiles([]);
            return [];
        }
        setIsLoadingUsers(true);
        try {
            const usersResponse = await authenticatedFetch("/api/users");
            if (usersResponse.ok) {
                const payload = (await usersResponse.json()) as { users?: AuthApiUser[] };
                const users = payload.users ?? [];
                const nextItems = toUserProfileListItems(users, auth.user?.id);
                setUserProfiles(nextItems);
                return nextItems;
            }

            const meResponse = await authenticatedFetch("/api/auth/me");
            if (!meResponse.ok) {
                setUserProfiles([]);
                return [];
            }
            const payload = (await meResponse.json()) as { user?: AuthApiUser };
            const user = payload.user ? [payload.user] : [];
            const nextItems = toUserProfileListItems(user, auth.user?.id);
            setUserProfiles(nextItems);
            return nextItems;
        } catch (error) {
            console.error("Failed to fetch user profiles:", error);
            setUserProfiles([]);
            return [];
        } finally {
            setIsLoadingUsers(false);
        }
    }, [auth.token, auth.user?.id, authenticatedFetch]);

    const loadInitialData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [loadedProfiles, loadedConfigs] = await Promise.all([
                fetchProfiles(),
                fetchConfigs(),
                fetchUserProfiles(),
            ]);
            const firstProfile = loadedProfiles[0]?.profile.name ?? null;
            if (!firstProfile) {
                setForm(emptyForm);
                setIsDirty(false);
                setMessage(null);
                return;
            }
            const resolvedSelected =
                (selectedProfileName && loadedProfiles.some((p) => p.profile.name === selectedProfileName)
                    ? selectedProfileName
                    : firstProfile);
            if (resolvedSelected !== selectedProfileName) {
                navigateToProfile(resolvedSelected, true);
            }
            const selectedConfig = loadedConfigs[resolvedSelected];
            if (selectedConfig) {
                setForm(toFormFromOverrides(selectedConfig));
                setIsDirty(false);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error("Failed to load profile data:", error);
            setMessage({ type: "error", text: errorMessage });
        } finally {
            setIsLoading(false);
        }
    }, [fetchConfigs, fetchProfiles, fetchUserProfiles, navigateToProfile, selectedProfileName]);

    useEffect(() => {
        loadInitialData();
    }, [loadInitialData]);

    useEffect(() => {
        const interval = setInterval(() => {
            fetchProfiles().catch((error) => {
                console.error("Failed to refresh profiles:", error);
            });
            fetchUserProfiles().catch((error) => {
                console.error("Failed to refresh user profiles:", error);
            });
        }, 5000);
        return () => clearInterval(interval);
    }, [fetchProfiles, fetchUserProfiles]);

    useEffect(() => {
        if (!selectedProfileName) {
            return;
        }
        if (configsByName[selectedProfileName]) {
            return;
        }
        fetchSingleConfig(selectedProfileName).catch((error) => {
            console.error("Failed to fetch selected profile config:", error);
        });
    }, [configsByName, fetchSingleConfig, selectedProfileName]);

    useEffect(() => {
        if (!selectedProfileName || isDirty) {
            return;
        }
        const selectedConfig = configsByName[selectedProfileName];
        if (!selectedConfig) {
            return;
        }
        setForm(toFormFromOverrides(selectedConfig));
    }, [configsByName, isDirty, selectedProfileName]);

    useEffect(() => {
        if (selectedProfileName && profiles.some((p) => p.profile.name === selectedProfileName)) {
            return;
        }
        const firstProfile = profiles[0]?.profile.name ?? null;
        if (!firstProfile) {
            setForm(emptyForm);
            setIsDirty(false);
            return;
        }
        navigateToProfile(firstProfile, true);
    }, [navigateToProfile, profiles, selectedProfileName]);

    const selectedProfile = useMemo(
        () => profiles.find((entry) => entry.profile.name === selectedProfileName) ?? null,
        [profiles, selectedProfileName],
    );

    const selectedConfig = selectedProfileName ? configsByName[selectedProfileName] : undefined;
    const resolvedRuntimeForModelOptions = useMemo(
        () =>
            form.runtimeName
            || selectedConfig?.effective.runtimeName
            || selectedProfile?.profile.runtimeName
            || selectedConfig?.defaults.runtimeName
            || "",
        [form.runtimeName, selectedConfig, selectedProfile?.profile.runtimeName],
    );
    const modelOptions = useMemo(
        () =>
            resolvedRuntimeForModelOptions === "opencode"
                ? OPENCODE_MODEL_OPTIONS
                : [],
        [resolvedRuntimeForModelOptions],
    );

    const formMatchesSelectedConfig = useMemo(() => {
        if (!selectedConfig) {
            return (
                form.runtimeName === ""
                && form.modelName === ""
                && form.systemPrompt === ""
                && form.taskPromptPrefix === ""
            );
        }
        const expected = toFormFromOverrides(selectedConfig);
        return (
            expected.runtimeName === form.runtimeName
            && expected.modelName === form.modelName
            && expected.systemPrompt === form.systemPrompt
            && expected.taskPromptPrefix === form.taskPromptPrefix
        );
    }, [form, selectedConfig]);

    useEffect(() => {
        if (!isDirty || !formMatchesSelectedConfig) {
            return;
        }
        setIsDirty(false);
    }, [formMatchesSelectedConfig, isDirty]);

    const effectivePreview = useMemo(() => {
        if (!selectedConfig) {
            return {
                runtimeName: form.runtimeName || undefined,
                modelName: form.modelName.trim() || undefined,
                systemPrompt: form.systemPrompt.trim() || undefined,
                taskPromptPrefix: form.taskPromptPrefix.trim() || undefined,
            };
        }
        return {
            runtimeName:
                form.runtimeName || selectedConfig.defaults.runtimeName || selectedConfig.effective.runtimeName,
            modelName:
                form.modelName.trim()
                || selectedConfig.defaults.modelName
                || selectedConfig.effective.modelName,
            systemPrompt:
                form.systemPrompt.trim()
                || selectedConfig.defaults.systemPrompt
                || selectedConfig.effective.systemPrompt,
            taskPromptPrefix:
                form.taskPromptPrefix.trim()
                || selectedConfig.defaults.taskPromptPrefix
                || selectedConfig.effective.taskPromptPrefix,
        };
    }, [form, selectedConfig]);

    const toggleProfileStatus = async (profileName: string, isActive: boolean) => {
        setMessage(null);
        try {
            const response = await authenticatedFetch(`/api/profiles/${encodeURIComponent(profileName)}/status`, {
                method: "PUT",
                headers: buildAuthHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({ isActive }),
            });
            if (!response.ok) {
                const payload = (await response.json().catch(() => ({}))) as { error?: string };
                throw new Error(payload.error ?? `Failed to update status (${response.status})`);
            }
            await fetchProfiles();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error("Failed to update profile status:", error);
            setMessage({ type: "error", text: errorMessage });
        }
    };

    const handleSelectProfile = (profileName: string) => {
        navigateToProfile(profileName);
        const selected = configsByName[profileName];
        setForm(selected ? toFormFromOverrides(selected) : emptyForm);
        setIsDirty(false);
        setMessage(null);
    };

    const updateForm = (
        key: keyof ProfileConfigForm,
        value: ProfileConfigForm[keyof ProfileConfigForm],
    ) => {
        setForm((current) => ({
            ...current,
            [key]: value,
        }));
        setIsDirty(true);
        setMessage(null);
    };

    const saveProfileConfig = async () => {
        if (!selectedProfileName) {
            return;
        }
        setIsSaving(true);
        setMessage(null);
        try {
            const response = await authenticatedFetch(
                `/api/profiles/${encodeURIComponent(selectedProfileName)}/config`,
                {
                    method: "PUT",
                    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
                    body: JSON.stringify({
                        runtimeName: form.runtimeName || null,
                        modelName: normalizeOptionalText(form.modelName),
                        systemPrompt: normalizeOptionalText(form.systemPrompt),
                        taskPromptPrefix: normalizeOptionalText(form.taskPromptPrefix),
                    }),
                },
            );
            if (!response.ok) {
                const payload = (await response.json().catch(() => ({}))) as { error?: string };
                throw new Error(payload.error ?? `Failed to save profile configuration (${response.status})`);
            }
            const updated = (await response.json()) as ProfileConfigurationSnapshot;
            setConfigsByName((current) => ({
                ...current,
                [updated.name]: updated,
            }));
            setIsDirty(false);
            setMessage({ type: "success", text: `Saved configuration for ${updated.name}.` });
            await fetchProfiles();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error("Failed to save profile configuration:", error);
            setMessage({ type: "error", text: errorMessage });
        } finally {
            setIsSaving(false);
        }
    };

    const resetToDefaults = async () => {
        if (!selectedProfileName) {
            return;
        }
        setIsSaving(true);
        setMessage(null);
        try {
            const response = await authenticatedFetch(
                `/api/profiles/${encodeURIComponent(selectedProfileName)}/config`,
                {
                    method: "PUT",
                    headers: buildAuthHeaders({ "Content-Type": "application/json" }),
                    body: JSON.stringify({
                        runtimeName: null,
                        modelName: null,
                        systemPrompt: null,
                        taskPromptPrefix: null,
                    }),
                },
            );
            if (!response.ok) {
                const payload = (await response.json().catch(() => ({}))) as { error?: string };
                throw new Error(payload.error ?? `Failed to reset profile configuration (${response.status})`);
            }
            const updated = (await response.json()) as ProfileConfigurationSnapshot;
            setConfigsByName((current) => ({
                ...current,
                [updated.name]: updated,
            }));
            setForm(toFormFromOverrides(updated));
            setIsDirty(false);
            setMessage({ type: "success", text: `Reset ${updated.name} to defaults.` });
            await fetchProfiles();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            console.error("Failed to reset profile configuration:", error);
            setMessage({ type: "error", text: errorMessage });
        } finally {
            setIsSaving(false);
        }
    };

    const discardEdits = () => {
        if (!selectedConfig) {
            setForm(emptyForm);
            setIsDirty(false);
            return;
        }
        setForm(toFormFromOverrides(selectedConfig));
        setIsDirty(false);
        setMessage(null);
    };

    if (isLoading) {
        return (
            <SectionCard title="Profile Management">
                <div style={{ textAlign: "center", padding: "40px" }}>Loading profiles...</div>
            </SectionCard>
        );
    }

    return (
        <div style={{ display: "grid", gap: "16px" }}>
            <SectionCard
                title="Multi-Profile System"
                countLabel={`${profiles.length + userProfiles.length} profiles`}
            >
                <div style={{ marginBottom: "16px", fontSize: "14px", color: "#94a3b8" }}>
                    User and agent profiles are shown here. Agent profiles can be configured with
                    runtime, model, and prompt overrides.
                </div>
                {message && (
                    <div
                        style={{
                            padding: "10px 12px",
                            borderRadius: "8px",
                            fontSize: "12px",
                            fontWeight: 500,
                            color: message.type === "success" ? "#86efac" : "#fecaca",
                            backgroundColor: message.type === "success" ? "#14532d" : "#7f1d1d",
                            border: `1px solid ${message.type === "success" ? "#166534" : "#991b1b"}`,
                        }}
                    >
                        {message.text}
                    </div>
                )}
            </SectionCard>

            <SectionCard title="User Profiles" countLabel={`${userProfiles.length} users`}>
                {!auth.isAuthenticated ? (
                    <div style={{ fontSize: "13px", color: "#94a3b8" }}>
                        Sign in to load user profiles.
                    </div>
                ) : isLoadingUsers && userProfiles.length === 0 ? (
                    <div style={{ fontSize: "13px", color: "#94a3b8" }}>Loading user profiles...</div>
                ) : userProfiles.length === 0 ? (
                    <div style={{ fontSize: "13px", color: "#94a3b8" }}>No user profiles found.</div>
                ) : (
                    <div
                        style={{
                            display: "grid",
                            gap: "10px",
                            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        }}
                    >
                        {userProfiles.map((userProfile) => (
                            <div
                                key={userProfile.id}
                                style={{
                                    borderRadius: "10px",
                                    border: "1px solid #334155",
                                    background: "#0f172a",
                                    color: "#e2e8f0",
                                    textAlign: "left",
                                    padding: "10px",
                                    display: "grid",
                                    gap: "6px",
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                                    <span style={{ fontSize: "13px", fontWeight: 600 }}>
                                        {userProfile.name?.trim() || userProfile.username}
                                    </span>
                                    {userProfile.isCurrentUser ? (
                                        <span style={{ fontSize: "11px", color: "#38bdf8" }}>You</span>
                                    ) : null}
                                </div>
                                <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                                    <div>Username: {userProfile.username}</div>
                                    <div>Email: {userProfile.email}</div>
                                    <div>Role: {userProfile.role}</div>
                                    {userProfile.bio ? <div>Bio: {userProfile.bio}</div> : null}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </SectionCard>

            <div
                style={{
                    display: "grid",
                    gap: "16px",
                    gridTemplateColumns: "minmax(280px, 1fr) minmax(460px, 2fr)",
                }}
            >
                <SectionCard title="Profiles">
                    <div style={{ display: "grid", gap: "10px" }}>
                        {profiles.map((profileData) => {
                            const config = configsByName[profileData.profile.name];
                            const runtime =
                                config?.effective.runtimeName ?? profileData.profile.runtimeName ?? "default";
                            const model =
                                config?.effective.modelName ?? profileData.profile.modelName ?? "default";
                            const isSelected = selectedProfileName === profileData.profile.name;
                            return (
                                <button
                                    key={profileData.profile.name}
                                    type="button"
                                    onClick={() => handleSelectProfile(profileData.profile.name)}
                                    style={{
                                        cursor: "pointer",
                                        borderRadius: "10px",
                                        border: `1px solid ${isSelected ? "#38bdf8" : "#334155"}`,
                                        background: isSelected ? "rgba(56, 189, 248, 0.14)" : "#0f172a",
                                        color: "#e2e8f0",
                                        textAlign: "left",
                                        padding: "10px",
                                        display: "grid",
                                        gap: "6px",
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: "8px",
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontSize: "13px",
                                                fontWeight: 600,
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "8px",
                                                flexWrap: "wrap",
                                            }}
                                        >
                                            <span>
                                                {profileData.profile.icon} {profileData.profile.role}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: "10px",
                                                    fontWeight: 700,
                                                    letterSpacing: "0.03em",
                                                    color: "#bae6fd",
                                                    background: "rgba(14, 165, 233, 0.18)",
                                                    border: "1px solid #0369a1",
                                                    borderRadius: "999px",
                                                    padding: "2px 6px",
                                                    textTransform: "uppercase",
                                                }}
                                            >
                                                LLM Agent
                                            </span>
                                        </span>
                                        <span
                                            style={{
                                                fontSize: "11px",
                                                color: profileData.state.isActive ? "#22c55e" : "#f87171",
                                            }}
                                        >
                                            {profileData.state.isActive ? "Active" : "Inactive"}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                                        <div>Name: {profileData.profile.name}</div>
                                        <div>Runtime: {runtime}</div>
                                        <div>Model: {model}</div>
                                        <div>Queue: {profileData.state.queueSize}</div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </SectionCard>

                <SectionCard title={selectedProfile ? `Profile Detail: ${selectedProfile.profile.name}` : "Profile Detail"}>
                    {!selectedProfile || !selectedProfileName ? (
                        <div style={{ color: "#94a3b8", fontSize: "13px" }}>
                            Select a profile to view and edit details.
                        </div>
                    ) : (
                        <div style={{ display: "grid", gap: "14px" }}>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1fr",
                                    gap: "12px",
                                    fontSize: "12px",
                                    color: "#94a3b8",
                                }}
                            >
                                <div>
                                    <strong style={{ color: "#e2e8f0" }}>Status:</strong>{" "}
                                    {selectedProfile.state.isProcessing ? "Processing" : "Idle"} /{" "}
                                    {selectedProfile.state.isActive ? "Active" : "Inactive"}
                                </div>
                                <div>
                                    <strong style={{ color: "#e2e8f0" }}>Last Activity:</strong>{" "}
                                    {formatLastActivity(selectedProfile.state.lastActivity)}
                                </div>
                                <div>
                                    <strong style={{ color: "#e2e8f0" }}>Throughput:</strong>{" "}
                                    {selectedProfile.metrics.throughput.toFixed(1)} tasks/hr
                                </div>
                                <div>
                                    <strong style={{ color: "#e2e8f0" }}>Success:</strong>{" "}
                                    {selectedProfile.metrics.successRate.toFixed(1)}%
                                </div>
                                <div>
                                    <strong style={{ color: "#e2e8f0" }}>Average Duration:</strong>{" "}
                                    {formatDuration(selectedProfile.metrics.averageTaskDuration)}
                                </div>
                                <div>
                                    <strong style={{ color: "#e2e8f0" }}>Config Updated:</strong>{" "}
                                    {formatTimestamp(selectedConfig?.updatedAt)}
                                </div>
                            </div>

                            <div
                                style={{
                                    borderTop: "1px solid #334155",
                                    paddingTop: "12px",
                                    display: "grid",
                                    gap: "12px",
                                }}
                            >
                                <label
                                    htmlFor="profile-runtime"
                                    style={{ display: "grid", gap: "6px", fontSize: "12px", color: "#cbd5e1" }}
                                >
                                    Agent Runtime
                                    <select
                                        id="profile-runtime"
                                        value={form.runtimeName}
                                        onChange={(event) =>
                                            updateForm(
                                                "runtimeName",
                                                event.target.value as "" | "codex" | "opencode",
                                            )
                                        }
                                        disabled={isSaving}
                                        style={{
                                            background: "#0b1220",
                                            color: "#f1f5f9",
                                            border: "1px solid #334155",
                                            borderRadius: "8px",
                                            padding: "8px 10px",
                                            fontSize: "12px",
                                        }}
                                    >
                                        <option value="">Use Default ({selectedConfig?.defaults.runtimeName ?? "none"})</option>
                                        <option value="codex">codex</option>
                                        <option value="opencode">opencode</option>
                                    </select>
                                </label>

                                <label
                                    htmlFor="profile-model"
                                    style={{ display: "grid", gap: "6px", fontSize: "12px", color: "#cbd5e1" }}
                                >
                                    Model Override
                                    {resolvedRuntimeForModelOptions === "opencode" ? (
                                        <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                                            Select an available opencode model or type a custom model name.
                                        </span>
                                    ) : (
                                        <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                                            Type any model name (runtime-specific suggestions appear for opencode).
                                        </span>
                                    )}
                                    <input
                                        id="profile-model"
                                        type="text"
                                        list="profile-model-options"
                                        value={form.modelName}
                                        onChange={(event) => updateForm("modelName", event.target.value)}
                                        disabled={isSaving}
                                        placeholder={selectedConfig?.defaults.modelName ?? "Use default model"}
                                        style={{
                                            background: "#0b1220",
                                            color: "#f1f5f9",
                                            border: "1px solid #334155",
                                            borderRadius: "8px",
                                            padding: "8px 10px",
                                            fontSize: "12px",
                                        }}
                                    />
                                    <datalist id="profile-model-options">
                                        {modelOptions.map((modelName) => (
                                            <option key={modelName} value={modelName} />
                                        ))}
                                    </datalist>
                                </label>

                                <label
                                    htmlFor="profile-system-prompt"
                                    style={{ display: "grid", gap: "6px", fontSize: "12px", color: "#cbd5e1" }}
                                >
                                    System Prompt Override
                                    <textarea
                                        id="profile-system-prompt"
                                        value={form.systemPrompt}
                                        onChange={(event) => updateForm("systemPrompt", event.target.value)}
                                        disabled={isSaving}
                                        rows={10}
                                        placeholder="Leave empty to use the in-code default prompt."
                                        style={{
                                            background: "#0b1220",
                                            color: "#f1f5f9",
                                            border: "1px solid #334155",
                                            borderRadius: "8px",
                                            padding: "10px",
                                            fontSize: "12px",
                                            lineHeight: 1.5,
                                            resize: "vertical",
                                        }}
                                    />
                                </label>

                                <label
                                    htmlFor="profile-task-prompt-prefix"
                                    style={{ display: "grid", gap: "6px", fontSize: "12px", color: "#cbd5e1" }}
                                >
                                    Task Prompt Prefix Override
                                    <textarea
                                        id="profile-task-prompt-prefix"
                                        value={form.taskPromptPrefix}
                                        onChange={(event) => updateForm("taskPromptPrefix", event.target.value)}
                                        disabled={isSaving}
                                        rows={6}
                                        placeholder="Optional prefix injected before the generated task prompt."
                                        style={{
                                            background: "#0b1220",
                                            color: "#f1f5f9",
                                            border: "1px solid #334155",
                                            borderRadius: "8px",
                                            padding: "10px",
                                            fontSize: "12px",
                                            lineHeight: 1.5,
                                            resize: "vertical",
                                        }}
                                    />
                                </label>

                                <div
                                    style={{
                                        background: "#0b1220",
                                        border: "1px solid #334155",
                                        borderRadius: "8px",
                                        padding: "10px",
                                        fontSize: "11px",
                                        color: "#94a3b8",
                                        lineHeight: 1.5,
                                    }}
                                >
                                    <div>
                                        <strong style={{ color: "#e2e8f0" }}>Effective Runtime:</strong>{" "}
                                        {effectivePreview.runtimeName ?? "none"}
                                    </div>
                                    <div>
                                        <strong style={{ color: "#e2e8f0" }}>Effective Model:</strong>{" "}
                                        {effectivePreview.modelName ?? "none"}
                                    </div>
                                    <div>
                                        <strong style={{ color: "#e2e8f0" }}>System Prompt Source:</strong>{" "}
                                        {form.systemPrompt.trim().length > 0 ? "override" : "default"}
                                    </div>
                                    <div>
                                        <strong style={{ color: "#e2e8f0" }}>Task Prompt Prefix Source:</strong>{" "}
                                        {form.taskPromptPrefix.trim().length > 0 ? "override" : "default/none"}
                                    </div>
                                </div>
                            </div>

                            <div
                                style={{
                                    borderTop: "1px solid #334155",
                                    paddingTop: "12px",
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "8px",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                }}
                            >
                                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                    <button
                                        type="button"
                                        onClick={saveProfileConfig}
                                        disabled={isSaving || !selectedProfileName || formMatchesSelectedConfig}
                                        style={{
                                            padding: "8px 12px",
                                            borderRadius: "8px",
                                            border: "none",
                                            fontSize: "12px",
                                            fontWeight: 600,
                                            cursor:
                                                isSaving || formMatchesSelectedConfig ? "default" : "pointer",
                                            backgroundColor: "#0284c7",
                                            color: "white",
                                            opacity: isSaving || formMatchesSelectedConfig ? 0.6 : 1,
                                        }}
                                    >
                                        {isSaving ? "Saving..." : "Save Changes"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={discardEdits}
                                        disabled={isSaving || formMatchesSelectedConfig}
                                        style={{
                                            padding: "8px 12px",
                                            borderRadius: "8px",
                                            border: "1px solid #334155",
                                            fontSize: "12px",
                                            fontWeight: 600,
                                            cursor:
                                                isSaving || formMatchesSelectedConfig ? "default" : "pointer",
                                            backgroundColor: "#0b1220",
                                            color: "#e2e8f0",
                                            opacity: isSaving || formMatchesSelectedConfig ? 0.6 : 1,
                                        }}
                                    >
                                        Discard
                                    </button>
                                    <button
                                        type="button"
                                        onClick={resetToDefaults}
                                        disabled={isSaving || !selectedProfileName}
                                        style={{
                                            padding: "8px 12px",
                                            borderRadius: "8px",
                                            border: "1px solid #7f1d1d",
                                            fontSize: "12px",
                                            fontWeight: 600,
                                            cursor: isSaving ? "default" : "pointer",
                                            backgroundColor: "#7f1d1d",
                                            color: "white",
                                            opacity: isSaving ? 0.6 : 1,
                                        }}
                                    >
                                        Reset to Defaults
                                    </button>
                                </div>

                                <button
                                    type="button"
                                    onClick={() =>
                                        toggleProfileStatus(
                                            selectedProfile.profile.name,
                                            !selectedProfile.state.isActive,
                                        )
                                    }
                                    style={{
                                        padding: "8px 12px",
                                        borderRadius: "8px",
                                        border: "none",
                                        fontSize: "12px",
                                        fontWeight: 600,
                                        cursor: "pointer",
                                        backgroundColor: selectedProfile.state.isActive ? "#ef4444" : "#16a34a",
                                        color: "white",
                                    }}
                                >
                                    {selectedProfile.state.isActive ? "Disable Profile" : "Enable Profile"}
                                </button>
                            </div>

                            {!formMatchesSelectedConfig && (
                                <div style={{ color: "#fbbf24", fontSize: "12px" }}>
                                    You have unsaved changes for this profile.
                                </div>
                            )}
                        </div>
                    )}
                </SectionCard>
            </div>
        </div>
    );
}
