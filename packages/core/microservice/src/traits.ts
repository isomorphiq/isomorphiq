import type { Self } from "@tsimpl/core";
import { method, trait } from "@tsimpl/runtime";
import type {
    MicroserviceHealthSnapshot,
    MicroserviceKind,
    MicroserviceLifecycleStatus,
} from "./domain.ts";

export const MicroserviceTrait = trait("MicroserviceTrait", {
    id: method<Self, string>(),
    name: method<Self, string>(),
    kind: method<Self, MicroserviceKind>(),
    status: method<Self, MicroserviceLifecycleStatus>(),
    endpoint: method<Self, string>(),
    start: method<Self, Promise<void>>({
        abstract: true,
    }),
    stop: method<Self, Promise<void>, [signal?: NodeJS.Signals]>({
        abstract: true,
    }),
    health: method<Self, Promise<MicroserviceHealthSnapshot>>({
        abstract: true,
    }),
});
