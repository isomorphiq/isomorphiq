import type { User } from "@isomorphiq/auth/types";
export declare const authAtom: import("jotai").PrimitiveAtom<{
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
}> & {
    init: {
        user: User | null;
        token: string | null;
        isAuthenticated: boolean;
        isLoading: boolean;
    };
};
export declare const loginErrorAtom: import("jotai").Atom<string>;
export declare const registerSuccessAtom: import("jotai").PrimitiveAtom<boolean> & {
    init: boolean;
};
