import { EventEmitter } from "node:events";
import type { TaskEvent } from "./task-events.ts";

export type TaskEventListener = (event: TaskEvent) => void;

/**
 * TODO: Reimplement this class using @tsimpl/core and @tsimpl/runtime's struct/trait/impl pattern inspired by Rust.
 */
export class TaskEventBus {
    private emitter = new EventEmitter();

    emit(event: TaskEvent): void {
        this.emitter.emit("event", event);
    }

    subscribe(listener: TaskEventListener): () => void {
        this.emitter.on("event", listener);
        return () => {
            this.emitter.off("event", listener);
        };
    }
}

