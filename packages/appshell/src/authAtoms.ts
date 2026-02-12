import type { User } from "@isomorphiq/auth/types";
import { atom } from "jotai";

export const authAtom = atom<{
	user: User | null;
	token: string | null;
	isAuthenticated: boolean;
	isLoading: boolean;
}>({
	user:
		typeof window !== "undefined"
			? (() => {
					try {
						const raw = localStorage.getItem("user");
						return raw ? JSON.parse(raw) : null;
					} catch {
						return null;
					}
				})()
			: null,
	token: typeof window !== "undefined" ? localStorage.getItem("authToken") : null,
	isAuthenticated: typeof window !== "undefined" ? !!localStorage.getItem("authToken") : false,
	isLoading: false,
});

export const loginErrorAtom = atom<string | null>(null);
export const registerSuccessAtom = atom<boolean>(false);
