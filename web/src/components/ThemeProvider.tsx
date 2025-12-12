import { useAtom } from "jotai";
import { useEffect } from "react";
import { effectiveThemeAtom, setStoredTheme, themeAtom, type Theme } from "../atoms/themeAtoms.ts";

export function useTheme() {
    const [theme, setTheme] = useAtom(themeAtom);
    const [effectiveTheme] = useAtom(effectiveThemeAtom);

    const updateTheme = (newTheme: Theme) => {
        setTheme(newTheme);
        setStoredTheme(newTheme);
    };

    return {
        theme,
        effectiveTheme,
        setTheme: updateTheme,
        isDark: effectiveTheme === "dark",
        isLight: effectiveTheme === "light",
    };
}

interface ThemeProviderProps {
    children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
    const { effectiveTheme } = useTheme();

    useEffect(() => {
        const root = document.documentElement;
        
        if (effectiveTheme === "dark") {
            root.classList.add("dark");
            root.classList.remove("light");
        } else {
            root.classList.add("light");
            root.classList.remove("dark");
        }

        // Apply CSS custom properties based on theme
        const colors = getThemeColors(effectiveTheme);
        Object.entries(colors).forEach(([key, value]) => {
            root.style.setProperty(`--color-${key}`, value);
        });
        
        // Update theme-color meta tag for mobile browsers
        const themeColorMeta = document.getElementById('theme-color');
        if (themeColorMeta) {
            themeColorMeta.setAttribute('content', colors['bg-primary']);
        }
    }, [effectiveTheme]);

    // Listen for system theme changes
    useEffect(() => {
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        
        const handleChange = () => {
            // This will trigger the effectiveThemeAtom to recalculate
            const event = new CustomEvent("system-theme-change");
            window.dispatchEvent(event);
        };

        mediaQuery.addEventListener("change", handleChange);
        return () => mediaQuery.removeEventListener("change", handleChange);
    }, []);

    return <>{children}</>;
}

function getThemeColors(theme: "light" | "dark") {
    if (theme === "light") {
        return {
            // Background colors
            "bg-primary": "#ffffff",
            "bg-secondary": "#f8fafc",
            "bg-tertiary": "#f1f5f9",
            "bg-inverse": "#0f172a",
            
            // Surface colors
            "surface-primary": "#ffffff",
            "surface-secondary": "#f8fafc",
            "surface-tertiary": "#f1f5f9",
            "surface-inverse": "#1e293b",
            
            // Text colors
            "text-primary": "#0f172a",
            "text-secondary": "#475569",
            "text-tertiary": "#64748b",
            "text-inverse": "#f8fafc",
            "text-muted": "#94a3b8",
            
            // Border colors
            "border-primary": "#e2e8f0",
            "border-secondary": "#cbd5e1",
            "border-tertiary": "#94a3b8",
            "border-inverse": "#334155",
            
            // Accent colors
            "accent-primary": "#3b82f6",
            "accent-primary-hover": "#2563eb",
            "accent-secondary": "#06b6d4",
            "accent-success": "#22c55e",
            "accent-warning": "#f59e0b",
            "accent-error": "#ef4444",
            
            // State colors
            "state-active-bg": "#eff6ff",
            "state-active-border": "#3b82f6",
            "state-hover-bg": "#f8fafc",
            "state-pressed-bg": "#f1f5f9",
            
            // Shadow colors
            "shadow-sm": "rgba(0, 0, 0, 0.05)",
            "shadow-md": "rgba(0, 0, 0, 0.1)",
            "shadow-lg": "rgba(0, 0, 0, 0.15)",
            "shadow-xl": "rgba(0, 0, 0, 0.25)",
        };
    } else {
        return {
            // Background colors
            "bg-primary": "#0f172a",
            "bg-secondary": "#0b1220",
            "bg-tertiary": "#111827",
            "bg-inverse": "#ffffff",
            
            // Surface colors
            "surface-primary": "#1e293b",
            "surface-secondary": "#334155",
            "surface-tertiary": "#475569",
            "surface-inverse": "#f8fafc",
            
            // Text colors
            "text-primary": "#f8fafc",
            "text-secondary": "#e2e8f0",
            "text-tertiary": "#cbd5e1",
            "text-inverse": "#0f172a",
            "text-muted": "#94a3b8",
            
            // Border colors
            "border-primary": "#334155",
            "border-secondary": "#475569",
            "border-tertiary": "#64748b",
            "border-inverse": "#e2e8f0",
            
            // Accent colors
            "accent-primary": "#3b82f6",
            "accent-primary-hover": "#2563eb",
            "accent-secondary": "#06b6d4",
            "accent-success": "#22c55e",
            "accent-warning": "#f59e0b",
            "accent-error": "#ef4444",
            
            // State colors
            "state-active-bg": "#1e3a8a",
            "state-active-border": "#3b82f6",
            "state-hover-bg": "#334155",
            "state-pressed-bg": "#475569",
            
            // Shadow colors
            "shadow-sm": "rgba(0, 0, 0, 0.1)",
            "shadow-md": "rgba(0, 0, 0, 0.25)",
            "shadow-lg": "rgba(0, 0, 0, 0.35)",
            "shadow-xl": "rgba(0, 0, 0, 0.5)",
        };
    }
}