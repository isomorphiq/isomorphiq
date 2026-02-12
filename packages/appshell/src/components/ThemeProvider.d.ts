import { type Theme } from "../atoms/themeAtoms.ts";
export declare function useTheme(): {
    theme: Theme;
    effectiveTheme: "light" | "dark";
    setTheme: (newTheme: Theme) => void;
    isDark: boolean;
    isLight: boolean;
};
interface ThemeProviderProps {
    children: React.ReactNode;
}
export declare function ThemeProvider({ children }: ThemeProviderProps): import("react/jsx-runtime").JSX.Element;
export {};
