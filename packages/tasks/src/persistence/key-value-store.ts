import { Level } from "level";

export type KeyValueIterator<K, V> = AsyncIterableIterator<[K, V]> & {
    close: () => Promise<void>;
};

export type KeyValueStore<K, V> = {
    open: () => Promise<void>;
    close: () => Promise<void>;
    get: (key: K) => Promise<V>;
    put: (key: K, value: V) => Promise<void>;
    del: (key: K) => Promise<void>;
    iterator: (opts?: Record<string, unknown>) => KeyValueIterator<K, V>;
};

export type KeyValueStoreFactory = <K, V>(dbPath: string) => KeyValueStore<K, V>;

export const createLevelStore = <K, V>(dbPath: string): KeyValueStore<K, V> => {
    const db = new Level<K, V>(dbPath, { valueEncoding: "json" });
    
    return {
        open: async () => {
            await db.open();
        },
        close: async () => {
            await db.close();
        },
        get: async (key: K) => {
            try {
                return await db.get(key);
            } catch (error: any) {
                if (error.code === 'LEVEL_NOT_FOUND') {
                    throw new Error("NotFound");
                }
                throw error;
            }
        },
        put: async (key: K, value: V) => {
            await db.put(key, value);
        },
        del: async (key: K) => {
            await db.del(key);
        },
        iterator: (opts?: Record<string, unknown>) => {
            const levelIterator = db.iterator(opts);
            
            const generator = async function* (): AsyncIterableIterator<[K, V]> {
                try {
                    while (true) {
                        const entry = await levelIterator.next();
                        if (!entry) {
                            break;
                        }
                        const [key, value] = entry as [K, V];
                        yield [key, value];
                    }
                } catch (error: any) {
                    if (error.code !== 'LEVEL_ITERATOR_CLOSE') {
                        throw error;
                    }
                }
            };
            
            const iterator = generator();
            return Object.assign(iterator, {
                close: async () => {
                    await levelIterator.close();
                },
            });
        },
    };
};

const normalizeBoundary = (value: unknown): string | undefined =>
    value === undefined || value === null ? undefined : String(value);

const createIterator = <K, V>(
    entries: Array<[K, V]>,
): KeyValueIterator<K, V> => {
    let closed = false;
    const generator = async function* (): AsyncIterableIterator<[K, V]> {
        for (const entry of entries) {
            if (closed) {
                return;
            }
            yield entry;
        }
    };
    const iterator = generator();
    return Object.assign(iterator, {
        close: async () => {
            closed = true;
        },
    });
};

export const createInMemoryStore: KeyValueStoreFactory = <K, V>(
    _dbPath: string,
): KeyValueStore<K, V> => {
    const store = new Map<K, V>();
    let isOpen = false;

    const ensureOpen = (): void => {
        if (!isOpen) {
            isOpen = true;
        }
    };

    return {
        open: async () => {
            isOpen = true;
        },
        close: async () => {
            isOpen = false;
        },
        get: async (key: K) => {
            ensureOpen();
            const value = store.get(key);
            if (value === undefined) {
                throw new Error("NotFound");
            }
            return value;
        },
        put: async (key: K, value: V) => {
            ensureOpen();
            store.set(key, value);
        },
        del: async (key: K) => {
            ensureOpen();
            store.delete(key);
        },
        iterator: (opts?: Record<string, unknown>) => {
            ensureOpen();
            const gte = normalizeBoundary(opts?.gte);
            const lte = normalizeBoundary(opts?.lte);
            const reverse = opts?.reverse === true;
            const limit = typeof opts?.limit === "number" ? opts?.limit : undefined;
            const entries = Array.from(store.entries())
                .sort(([left], [right]) => String(left).localeCompare(String(right)))
                .filter(([key]) => {
                    const keyValue = String(key);
                    if (gte !== undefined && keyValue < gte) {
                        return false;
                    }
                    if (lte !== undefined && keyValue > lte) {
                        return false;
                    }
                    return true;
                });
            const ordered = reverse ? [...entries].reverse() : entries;
            const limited = limit !== undefined ? ordered.slice(0, limit) : ordered;
            return createIterator(limited);
        },
    };
};
