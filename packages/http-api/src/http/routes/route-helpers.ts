import type { IncomingHttpHeaders } from "node:http";
import type { ProductManager } from "@isomorphiq/user-profile";
import type { ProfileManager } from "@isomorphiq/user-profile";

export type ProductManagerResolver = (req: { headers: IncomingHttpHeaders }) => ProductManager;
export type ProfileManagerResolver = (req: { headers: IncomingHttpHeaders }) => ProfileManager;

export const normalizeProductManagerResolver = (
    pmOrResolver: ProductManager | ProductManagerResolver,
): ProductManagerResolver => {
    if (typeof pmOrResolver === "function") {
        return pmOrResolver as ProductManagerResolver;
    }
    return () => pmOrResolver;
};

export const normalizeProfileManagerResolver = (
    managerOrResolver: ProfileManager | ProfileManagerResolver,
): ProfileManagerResolver => {
    if (typeof managerOrResolver === "function") {
        return managerOrResolver as ProfileManagerResolver;
    }
    return () => managerOrResolver;
};
