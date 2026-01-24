import type { KeyValueAdapter, KeyValueIterator } from "@isomorphiq/persistence-adapter";

/**
 * Placeholder immudb adapter. Intended to wrap the immudb client with the shared persistence interface.
 */
export class ImmudbAdapter<K = string, V = unknown> implements KeyValueAdapter<K, V> {
    /* eslint-disable @typescript-eslint/no-unused-vars */
    constructor(_config: Record<string, unknown> = {}) {}
    /* eslint-enable @typescript-eslint/no-unused-vars */

    async open(): Promise<void> {
        throw new Error("Immudb adapter not implemented yet");
    }

    async close(): Promise<void> {
        return;
    }

    async get(_key: K): Promise<V> {
        throw new Error("Immudb adapter not implemented yet");
    }

    async put(_key: K, _value: V): Promise<void> {
        throw new Error("Immudb adapter not implemented yet");
    }

    async del(_key: K): Promise<void> {
        throw new Error("Immudb adapter not implemented yet");
    }

    iterator(_options: Record<string, unknown> = {}): KeyValueIterator<K, V> {
        throw new Error("Immudb adapter not implemented yet");
    }
}
