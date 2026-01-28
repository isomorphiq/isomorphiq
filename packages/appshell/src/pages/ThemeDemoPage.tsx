import { useState } from "react";
import { Header, Layout } from "../components/Layout.tsx";
import { ThemeProvider, useTheme } from "../components/ThemeProvider.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";

function ThemeDemo() {
    const { theme, effectiveTheme, setTheme, isDark, isLight } = useTheme();

    return (
        <div style={{ padding: "20px" }}>
            <h2>Theme System Demo</h2>
            
            <div style={{ marginBottom: "20px" }}>
                <h3>Current Theme State</h3>
                <p><strong>Theme Preference:</strong> {theme}</p>
                <p><strong>Effective Theme:</strong> {effectiveTheme}</p>
                <p><strong>Is Dark:</strong> {isDark ? "Yes" : "No"}</p>
                <p><strong>Is Light:</strong> {isLight ? "Yes" : "No"}</p>
            </div>

            <div style={{ marginBottom: "20px" }}>
                <h3>Theme Controls</h3>
                <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
                    <button 
                        onClick={() => setTheme("light")}
                        style={{
                            padding: "8px 16px",
                            backgroundColor: "var(--color-accent-primary)",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer"
                        }}
                    >
                        Light Mode
                    </button>
                    <button 
                        onClick={() => setTheme("dark")}
                        style={{
                            padding: "8px 16px",
                            backgroundColor: "var(--color-accent-primary)",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer"
                        }}
                    >
                        Dark Mode
                    </button>
                    <button 
                        onClick={() => setTheme("system")}
                        style={{
                            padding: "8px 16px",
                            backgroundColor: "var(--color-accent-primary)",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: "pointer"
                        }}
                    >
                        System Mode
                    </button>
                </div>
                <div>
                    <ThemeToggle size="medium" showLabel={true} />
                </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
                <h3>Color Palette Test</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" }}>
                    <div style={{ 
                        padding: "10px", 
                        backgroundColor: "var(--color-bg-primary)",
                        border: "1px solid var(--color-border-primary)",
                        borderRadius: "4px"
                    }}>
                        <strong>Background Primary</strong>
                        <p style={{ color: "var(--color-text-primary)" }}>Text Primary</p>
                        <p style={{ color: "var(--color-text-secondary)" }}>Text Secondary</p>
                        <p style={{ color: "var(--color-text-muted)" }}>Text Muted</p>
                    </div>
                    
                    <div style={{ 
                        padding: "10px", 
                        backgroundColor: "var(--color-surface-primary)",
                        border: "1px solid var(--color-border-primary)",
                        borderRadius: "4px"
                    }}>
                        <strong>Surface Primary</strong>
                        <p>Card surface with borders</p>
                    </div>
                    
                    <div style={{ 
                        padding: "10px", 
                        backgroundColor: "var(--color-accent-primary)",
                        color: "white",
                        borderRadius: "4px"
                    }}>
                        <strong>Accent Primary</strong>
                        <p>Primary action color</p>
                    </div>
                    
                    <div style={{ 
                        padding: "10px", 
                        backgroundColor: "var(--color-accent-success)",
                        color: "white",
                        borderRadius: "4px"
                    }}>
                        <strong>Success Color</strong>
                        <p>Success state</p>
                    </div>
                    
                    <div style={{ 
                        padding: "10px", 
                        backgroundColor: "var(--color-accent-error)",
                        color: "white",
                        borderRadius: "4px"
                    }}>
                        <strong>Error Color</strong>
                        <p>Error state</p>
                    </div>
                    
                    <div style={{ 
                        padding: "10px", 
                        backgroundColor: "var(--color-accent-warning)",
                        color: "white",
                        borderRadius: "4px"
                    }}>
                        <strong>Warning Color</strong>
                        <p>Warning state</p>
                    </div>
                </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
                <h3>Interactive Elements Test</h3>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button style={{
                        padding: "8px 16px",
                        backgroundColor: "var(--color-accent-primary)",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer"
                    }}>
                        Primary Button
                    </button>
                    <button style={{
                        padding: "8px 16px",
                        backgroundColor: "transparent",
                        color: "var(--color-text-primary)",
                        border: "1px solid var(--color-border-primary)",
                        borderRadius: "4px",
                        cursor: "pointer"
                    }}>
                        Secondary Button
                    </button>
                    <input 
                        type="text" 
                        placeholder="Test input"
                        style={{
                            padding: "8px 12px",
                            backgroundColor: "var(--color-bg-primary)",
                            color: "var(--color-text-primary)",
                            border: "1px solid var(--color-border-primary)",
                            borderRadius: "4px"
                        }}
                    />
                </div>
            </div>
        </div>
    );
}

export function ThemeDemoPage() {
    return (
        <ThemeProvider>
            <Layout>
                <Header title="Theme Demo" showAuthControls={false} />
                <ThemeDemo />
            </Layout>
        </ThemeProvider>
    );
}