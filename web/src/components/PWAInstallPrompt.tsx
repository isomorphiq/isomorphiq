import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{
		outcome: "accepted" | "dismissed";
	}>;
}

interface NavigatorWithStandalone extends Navigator {
	standalone?: boolean;
}

interface PWAInstallPromptProps {
	onInstall?: () => void;
}

export function PWAInstallPrompt({ onInstall }: PWAInstallPromptProps) {
	const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
	const [showInstallButton, setShowInstallButton] = useState(false);
	const [isInstalled, setIsInstalled] = useState(false);

	useEffect(() => {
		// Check if app is already installed
		const checkInstalled = () => {
			const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
			const isInWebAppiOS = (window.navigator as NavigatorWithStandalone).standalone === true;
			setIsInstalled(isStandalone || isInWebAppiOS);
		};

		checkInstalled();

		// Listen for beforeinstallprompt event
		const handleBeforeInstallPrompt = (e: BeforeInstallPromptEvent) => {
			e.preventDefault();
			setDeferredPrompt(e);
			setShowInstallButton(true);
		};

		// Listen for app installed event
		const handleAppInstalled = () => {
			setShowInstallButton(false);
			setDeferredPrompt(null);
			setIsInstalled(true);
			if (onInstall) onInstall();
		};

		window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
		window.addEventListener("appinstalled", handleAppInstalled);

		return () => {
			window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
			window.removeEventListener("appinstalled", handleAppInstalled);
		};
	}, [onInstall]);

	const handleInstallClick = async () => {
		if (!deferredPrompt) return;

		deferredPrompt.prompt();
		const { outcome } = await deferredPrompt.userChoice;

		if (outcome === "accepted") {
			console.log("User accepted the install prompt");
		} else {
			console.log("User dismissed the install prompt");
		}

		setDeferredPrompt(null);
		setShowInstallButton(false);
	};

	if (isInstalled || !showInstallButton) {
		return null;
	}

	const isMobile = window.innerWidth <= 768;

	return (
		<div
			style={{
				position: "fixed",
				bottom: isMobile ? "80px" : "20px",
				right: "20px",
				background: "#0b1220",
				border: "1px solid #1f2937",
				borderRadius: "12px",
				padding: "16px",
				boxShadow: "0 10px 20px rgba(0,0,0,0.35)",
				zIndex: 1000,
				maxWidth: isMobile ? "calc(100vw - 40px)" : "320px",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
				<div
					style={{
						width: "48px",
						height: "48px",
						background: "#3b82f6",
						borderRadius: "12px",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: "24px",
						flexShrink: 0,
					}}
				>
					📱
				</div>

				<div style={{ flex: 1, minWidth: 0 }}>
					<h3
						style={{
							margin: "0 0 4px 0",
							fontSize: isMobile ? "14px" : "16px",
							color: "#f9fafb",
							fontWeight: 600,
						}}
					>
						Install Isomorphia
					</h3>
					<p
						style={{
							margin: 0,
							fontSize: isMobile ? "12px" : "13px",
							color: "#94a3b8",
							lineHeight: 1.4,
						}}
					>
						Install our app for a better experience with offline support and quick access.
					</p>
				</div>

				<button
					type="button"
					onClick={handleInstallClick}
					style={{
						background: "#3b82f6",
						color: "white",
						border: "none",
						borderRadius: "8px",
						padding: isMobile ? "8px 12px" : "10px 16px",
						fontSize: isMobile ? "12px" : "14px",
						fontWeight: 600,
						cursor: "pointer",
						whiteSpace: "nowrap",
						flexShrink: 0,
					}}
				>
					Install
				</button>
			</div>

			<button
				type="button"
				onClick={() => setShowInstallButton(false)}
				style={{
					position: "absolute",
					top: "8px",
					right: "8px",
					background: "none",
					border: "none",
					color: "#64748b",
					fontSize: "16px",
					cursor: "pointer",
					padding: "4px",
					borderRadius: "4px",
				}}
			>
				✕
			</button>
		</div>
	);
}
