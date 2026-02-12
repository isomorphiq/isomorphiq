import { Level } from "level";
import { WorkerRecordSchema, type WorkerRecord } from "./worker-manager-domain.ts";

type WorkerRecordStore = {
    open: () => Promise<void>;
    close: () => Promise<void>;
    get: (workerId: string) => Promise<WorkerRecord | null>;
    put: (record: WorkerRecord) => Promise<void>;
    del: (workerId: string) => Promise<void>;
    list: () => Promise<readonly WorkerRecord[]>;
};

const parseRecord = (value: unknown): WorkerRecord =>
    WorkerRecordSchema.parse(value) as WorkerRecord;

export const createWorkerRecordStore = (dbPath: string): WorkerRecordStore => {
    const db = new Level<string, WorkerRecord>(dbPath, {
        valueEncoding: "json",
    });
    let opened = false;

    const open = async (): Promise<void> => {
        if (opened) {
            return;
        }
        await db.open();
        opened = true;
    };

    const close = async (): Promise<void> => {
        if (!opened) {
            return;
        }
        await db.close();
        opened = false;
    };

    const get = async (workerId: string): Promise<WorkerRecord | null> => {
        await open();
        try {
            const value = await db.get(workerId);
            return parseRecord(value);
        } catch {
            return null;
        }
    };

    const put = async (record: WorkerRecord): Promise<void> => {
        await open();
        await db.put(record.id, record);
    };

    const del = async (workerId: string): Promise<void> => {
        await open();
        await db.del(workerId);
    };

    const list = async (): Promise<readonly WorkerRecord[]> => {
        await open();
        const records: WorkerRecord[] = [];
        const iterator = db.iterator();
        for await (const [, value] of iterator) {
            try {
                records.push(parseRecord(value));
            } catch (error) {
                console.warn("[WORKER-MANAGER] Skipping invalid worker record:", error);
            }
        }
        await iterator.close();
        return records.sort((left, right) => left.id.localeCompare(right.id));
    };

    return {
        open,
        close,
        get,
        put,
        del,
        list,
    };
};
