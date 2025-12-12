import { useTheme } from "./ThemeProvider.tsx";

interface ThemeToggleProps {
    size?: "small" | "medium" | "large";
    showLabel?: boolean;
}

export function ThemeToggle({ size = "medium", showLabel = false }: ThemeToggleProps) {
    const { theme, setTheme, isDark } = useTheme();

    const sizeStyles = {
        small: {
            width: "32px",
            height: "18px",
            fontSize: "10px",
        },
        medium: {
            width: "44px",
            height: "24px",
            fontSize: "12px",
        },
        large: {
            width: "56px",
            height: "30px",
            fontSize: "14px",
        },
    };

    const currentSize = sizeStyles[size];

    const toggleTheme = () => {
        if (theme === "system") {
            setTheme("light");
        } else if (theme === "light") {
            setTheme("dark");
        } else {
            setTheme("system");
        }
    };

    const getIcon = () => {
        if (theme === "system") {
            return isDark ? "🌙" : "☀️";
        }
        return theme === "dark" ? "🌙" : "☀️";
    };

    const getLabel = () => {
        if (theme === "system") {
            return `System (${isDark ? "Dark" : "Light"})`;
        }
        return theme === "dark" ? "Dark" : "Light";
    };

    return (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
                type="button"
                onClick={toggleTheme}
                style={{
                    width: currentSize.width,
                    height: currentSize.height,
                    backgroundColor: isDark ? "var(--color-accent-primary)" : "var(--color-border-secondary)",
                    border: "1px solid var(--color-border-primary)",
                    borderRadius: "9999px",
                    position: "relative",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: currentSize.fontSize,
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = isDark 
                        ? "var(--color-accent-primary-hover)" 
                        : "var(--color-border-tertiary)";
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = isDark 
                        ? "var(--color-accent-primary)" 
                        : "var(--color-border-secondary)";
                }}
            >
                <span
                    style={{
                        position: "absolute",
                        left: "2px",
                        width: "calc(50% - 4px)",
                        height: "calc(100% - 4px)",
                        backgroundColor: "var(--color-bg-primary)",
                        borderRadius: "9999px",
                        transform: isDark ? "translateX(100%)" : "translateX(0)",
                        transition: "transform 0.2s ease",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    {getIcon()}
                </span>
            </button>
            {showLabel && (
                <span
                    style={{
                        fontSize: "12px",
                        color: "var(--color-text-secondary)",
                        fontWeight: 500,
                    }}
                >
                    {getLabel()}
                </span>
            )}
        </div>
    );
}