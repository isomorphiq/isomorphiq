import { Level } from "level";
import type { KeyValueAdapter, KeyValueIterator } from "@isomorphiq/persistence-adapter";

export class LevelKeyValueAdapter<K = string, V = unknown> implements KeyValueAdapter<K, V> {
    private db: Level<K, V>;
    private isOpen = false;

    constructor(dbPath: string, options: Record<string, unknown> = {}) {
        this.db = new Level<K, V>(dbPath, { valueEncoding: "json", ...options });
    }

    async open(): Promise<void> {
        if (this.isOpen) return;
        await this.db.open();
        this.isOpen = true;
    }

    async close(): Promise<void> {
        if (!this.isOpen) return;
        await this.db.close();
        this.isOpen = false;
    }

    async get(key: K): Promise<V> {
        await this.open();
        return await this.db.get(key);
    }

    async put(key: K, value: V): Promise<void> {
        await this.open();
        await this.db.put(key, value);
    }

    async del(key: K): Promise<void> {
        await this.open();
        await this.db.del(key);
    }

    iterator(options: Record<string, unknown> = {}): KeyValueIterator<K, V> {
        const it = this.db.iterator(options);
        const closer =
            typeof (it as unknown as { close?: () => Promise<void> }).close === "function"
                ? (it as unknown as { close: () => Promise<void> }).close
                : async () => {
                      if (typeof (it as unknown as AsyncIterableIterator<[K, V]>).return === "function") {
                          await (it as unknown as AsyncIterableIterator<[K, V]>).return?.();
                      }
                  };
        return Object.assign(it as unknown as AsyncIterableIterator<[K, V]>, {
            close: closer,
        }) as KeyValueIterator<K, V>;
    }

    async batch(ops: Array<{ type: "put" | "del"; key: K; value?: V }>): Promise<void> {
        await this.open();
        await (this.db as unknown as { batch: (op: Array<unknown>) => Promise<void> }).batch(ops);
    }
}
