import { atom } from "jotai";

export type Theme = "light" | "dark" | "system";

// Theme preference atom
export const themeAtom = atom<Theme>("system");

// Derived atom for the actual theme to apply
export const effectiveThemeAtom = atom((get) => {
    const theme = get(themeAtom);
    
    if (theme === "system") {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    
    return theme;
});

// Initialize theme from localStorage
const getStoredTheme = (): Theme => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark" || stored === "system") {
        return stored;
    }
    return "system";
};

// Store theme preference
export const setStoredTheme = (theme: Theme) => {
    localStorage.setItem("theme", theme);
};

// Initialize with stored value
export const initialTheme = getStoredTheme();