export interface KeyValueIterator<K = string, V = unknown>
    extends AsyncIterableIterator<[K, V]> {
    close(): Promise<void>;
}

export interface KeyValueAdapter<K = string, V = unknown> {
    open(): Promise<void>;
    close(): Promise<void>;
    get(key: K): Promise<V>;
    put(key: K, value: V): Promise<void>;
    del(key: K): Promise<void>;
    iterator(options?: Record<string, unknown>): KeyValueIterator<K, V>;
    batch?(
        ops: Array<{ type: "put" | "del"; key: K; value?: V }>,
    ): Promise<void>;
}

export abstract class BaseKeyValueAdapter<K = string, V = unknown>
    implements KeyValueAdapter<K, V> {
    abstract open(): Promise<void>;
    abstract close(): Promise<void>;
    abstract get(key: K): Promise<V>;
    abstract put(key: K, value: V): Promise<void>;
    abstract del(key: K): Promise<void>;
    abstract iterator(options?: Record<string, unknown>): KeyValueIterator<K, V>;
}
