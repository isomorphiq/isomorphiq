import { promises as fs } from "fs";
import path from "path";
import { DashboardStateSchema, type DashboardState } from "./dashboard-model.ts";

export type DashboardStorage = {
    load: () => Promise<DashboardState | null>;
    save: (state: DashboardState) => Promise<void>;
};

const hasCode = (value: unknown): value is { code: unknown } =>
    typeof value === "object" && value !== null && "code" in value;

const isFileNotFound = (error: unknown): boolean => hasCode(error) && error.code === "ENOENT";

export const createJsonFileDashboardStorage = (filePath: string): DashboardStorage => {
    const load = async (): Promise<DashboardState | null> => {
        try {
            const raw = await fs.readFile(filePath, "utf-8");
            const parsed = JSON.parse(raw);
            return DashboardStateSchema.parse(parsed);
        } catch (error) {
            if (isFileNotFound(error)) {
                return null;
            }

            throw error;
        }
    };

    const save = async (state: DashboardState): Promise<void> => {
        const directory = path.dirname(filePath);
        await fs.mkdir(directory, { recursive: true });
        const payload = JSON.stringify(state, null, 4);
        const tempPath = `${filePath}.tmp`;
        await fs.writeFile(tempPath, payload, "utf-8");
        await fs.rename(tempPath, filePath);
    };

    return { load, save };
};

export const createInMemoryDashboardStorage = (
    initialState: DashboardState | null = null
): DashboardStorage => {
    let state = initialState;

    const load = async (): Promise<DashboardState | null> => state;
    const save = async (nextState: DashboardState): Promise<void> => {
        state = nextState;
    };

    return { load, save };
};
