export type Theme = "light" | "dark" | "system";
export declare const themeAtom: import("jotai").PrimitiveAtom<Theme> & {
    init: Theme;
};
export declare const effectiveThemeAtom: import("jotai").Atom<"light" | "dark">;
export declare const setStoredTheme: (theme: Theme) => void;
export declare const initialTheme: Theme;
