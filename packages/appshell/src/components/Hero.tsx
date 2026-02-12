// FILE_CONTEXT: "context-615f5b37-1a17-4a46-a2c6-9e65576487c0"

import { useId } from "react";
import { Link } from "react-router-dom";

export function Hero() {
    const headingId = useId();

    return (
        <section style={heroShell} aria-labelledby={headingId}>
            <div style={heroBg}>
                <div style={orbOne} />
                <div style={orbTwo} />
                <div style={heroContent}>
                    <div style={leftCol}>
                        <div style={eyebrow}>LIVE · ACP-POWERED · ALWAYS ON</div>
                        <h2 id={headingId} style={headline}>
                            Command the flow from idea to done.
                        </h2>
                        <p style={body}>
                            This is the command surface: tasks streaming from the daemon (tRPC + WebSockets), a
                            truthful queue, and a coloured-petri-token workflow that marches from product research
                            to delivery while ACP turns do the heavy lifting.
                        </p>
                        <div style={ctaRow}>
                            <Link to="/workflow" style={pillPrimary}>
                                🕸️ View workflow graph
                            </Link>
                            <a href="/api/health" style={pillGhost} target="_blank" rel="noreferrer">
                                💓 API health
                            </a>
                            <a href="/trpc" style={pillGhost} target="_blank" rel="noreferrer">
                                🔌 tRPC endpoint
                            </a>
                        </div>
                    </div>

                    <div style={rightCol}>
                        <div style={halo} />
                        <div style={spotCard}>
                            <div style={spotHeader}>
                                <span style={liveDot} />
                                Token: In-flight
                            </div>
                            <div style={spotTitle}>Next action: Queue → Tests</div>
                            <div style={spotMeta}>
                                <div>
                                    <div style={spotLabel}>Current profile</div>
                                    <div style={spotValue}>Development</div>
                                </div>
                                <div>
                                    <div style={spotLabel}>Mode</div>
                                    <div style={spotValue}>ACP turn</div>
                                </div>
                                <div>
                                    <div style={spotLabel}>Channel</div>
                                    <div style={spotValue}>tRPC + WS</div>
                                </div>
                            </div>
                        </div>
                        <div style={statRow}>
                            <div style={statCard}>
                                <div style={statLabel}>Queue integrity</div>
                                <div style={statValue}>Bidirectional WS · live</div>
                            </div>
                            <div style={statCard}>
                                <div style={statLabel}>Workflow safety</div>
                                <div style={statValue}>Token-driven · DAG safe</div>
                            </div>
                            <div style={statCard}>
                                <div style={statLabel}>ACP bench</div>
                                <div style={statValue}>PM · UX · Dev · QA</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

const heroShell: React.CSSProperties = {
	position: "relative",
	borderRadius: "18px",
	overflow: "hidden",
	border: "1px solid var(--color-border-primary)",
	boxShadow: "0 16px 40px var(--color-shadow-lg)",
	marginBottom: "6px",
};

const heroBg: React.CSSProperties = {
	padding: "36px 30px",
	background:
		"radial-gradient(circle at 18% 22%, rgba(56,189,248,0.18) 0, transparent 34%), radial-gradient(circle at 78% 8%, rgba(248,113,113,0.18) 0, transparent 32%), linear-gradient(120deg, var(--color-bg-primary) 0%, var(--color-bg-secondary) 45%, var(--color-bg-tertiary) 100%)",
	position: "relative",
	overflow: "hidden",
};

const heroContent: React.CSSProperties = {
	maxWidth: 980,
	margin: "0 auto",
	position: "relative",
	zIndex: 2,
	display: "grid",
	gridTemplateColumns: "1.05fr 0.95fr",
	gap: "18px",
	alignItems: "center",
};

const leftCol: React.CSSProperties = {
	display: "grid",
	gap: "10px",
};

const rightCol: React.CSSProperties = {
	position: "relative",
	display: "grid",
	gap: "10px",
};

const eyebrow: React.CSSProperties = {
	fontSize: 14,
	fontWeight: 800,
	color: "var(--color-accent-primary)",
	letterSpacing: "0.12em",
};

const headline: React.CSSProperties = {
	fontSize: 37,
	margin: "8px 0 0",
	lineHeight: 1.05,
	fontWeight: 840,
	color: "var(--color-text-primary)",
	letterSpacing: "-0.015em",
	textTransform: "none",
	fontFamily: "Bruno Ace, Inter, system-ui, sans-serif",
};

const body: React.CSSProperties = {
	margin: "6px 0 18px",
	color: "var(--color-text-secondary)",
	fontSize: 16,
	maxWidth: 760,
	lineHeight: 1.6,
	fontFamily: "Inter, system-ui, sans-serif",
};

const pulseAnim = {
	animation: "pulse 8s ease-in-out infinite",
};

const orbBase: React.CSSProperties = {
	position: "absolute",
	borderRadius: "50%",
	filter: "blur(26px)",
	opacity: 0.6,
	mixBlendMode: "screen",
};

const orbOne: React.CSSProperties = {
	...orbBase,
	width: 420,
	height: 420,
	top: -120,
	left: -140,
	background: "radial-gradient(circle, rgba(59,130,246,0.38) 0%, rgba(59,130,246,0) 70%)",
	...pulseAnim,
};

const orbTwo: React.CSSProperties = {
	...orbBase,
	width: 360,
	height: 360,
	bottom: -120,
	right: -100,
	background: "radial-gradient(circle, rgba(16,185,129,0.32) 0%, rgba(16,185,129,0) 72%)",
	animation: "pulse 10s ease-in-out infinite reverse",
};

const ctaRow: React.CSSProperties = {
	display: "flex",
	gap: "10px",
	flexWrap: "wrap",
	marginTop: "4px",
};

const halo: React.CSSProperties = {
	position: "absolute",
	top: "-10%",
	right: "-8%",
	width: 220,
	height: 220,
	background: "radial-gradient(circle, rgba(14,165,233,0.28) 0%, rgba(14,165,233,0) 70%)",
	filter: "blur(2px)",
	zIndex: 0,
};

const spotCard: React.CSSProperties = {
	position: "relative",
	zIndex: 1,
	background: "var(--color-surface-secondary)",
	border: "1px solid var(--color-border-secondary)",
	borderRadius: "14px",
	padding: "14px",
	boxShadow: "0 14px 30px var(--color-shadow-xl)",
	color: "var(--color-text-primary)",
};

const spotHeader: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "8px",
	fontSize: 12,
	color: "var(--color-text-muted)",
	fontWeight: 700,
};

const liveDot: React.CSSProperties = {
	width: 10,
	height: 10,
	borderRadius: "50%",
	background: "var(--color-accent-success)",
	boxShadow: "0 0 0 6px rgba(34,197,94,0.15)",
};

const spotTitle: React.CSSProperties = {
	marginTop: 6,
	fontSize: 18,
	fontWeight: 800,
	color: "var(--color-text-primary)",
};

const spotMeta: React.CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
	gap: "10px",
	marginTop: 12,
};

const spotLabel: React.CSSProperties = {
	fontSize: 11,
	color: "var(--color-text-muted)",
	letterSpacing: "0.04em",
};
const spotValue: React.CSSProperties = { fontSize: 13, color: "var(--color-text-secondary)", fontWeight: 700 };

const statRow: React.CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
	gap: "12px",
	marginTop: "16px",
};

const statCard: React.CSSProperties = {
	padding: "12px 14px",
	borderRadius: "12px",
	border: "1px solid var(--color-border-secondary)",
	background: "var(--color-surface-primary)",
	boxShadow: "0 12px 26px var(--color-shadow-lg)",
};

const statLabel: React.CSSProperties = {
	fontSize: 12,
	color: "var(--color-text-secondary)",
	fontWeight: 700,
	letterSpacing: "0.03em",
};
const statValue: React.CSSProperties = {
	fontSize: 15,
	color: "var(--color-text-primary)",
	fontWeight: 800,
	marginTop: 4,
};

const pillBase: React.CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	gap: "6px",
	padding: "10px 14px",
	borderRadius: "999px",
	fontWeight: 700,
	textDecoration: "none",
	border: "1px solid transparent",
	transition: "transform 0.15s ease, box-shadow 0.15s ease",
};

const pillPrimary: React.CSSProperties = {
	...pillBase,
	background: "var(--color-accent-primary)",
	color: "var(--color-text-on-accent)",
	boxShadow: "0 10px 20px var(--color-shadow-lg)",
};

const pillGhost: React.CSSProperties = {
	...pillBase,
	background: "var(--color-surface-primary)",
	color: "var(--color-text-primary)",
	border: "1px solid var(--color-border-secondary)",
};

// Keyframes for subtle orb pulsing (injected once on the client)
const styleTagId = "hero-pulse-keyframes";
if (typeof document !== "undefined" && !document.getElementById(styleTagId)) {
	const tag = document.createElement("style");
	tag.id = styleTagId;
	tag.innerHTML = `
@keyframes pulse {
  0% { transform: scale(0.94); opacity: 0.55; }
  50% { transform: scale(1.03); opacity: 0.75; }
  100% { transform: scale(0.94); opacity: 0.55; }
}`;
	document.head.appendChild(tag);
}
