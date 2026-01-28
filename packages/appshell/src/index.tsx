import { Provider as JotaiProvider } from "jotai";
import { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";

const container = document.getElementById("root");

if (container) {
	const root = createRoot(container);
	root.render(
		<JotaiProvider>
			<ErrorBoundary>
				<Suspense
					fallback={
						<div
							style={{
								padding: "24px",
								color: "#e2e8f0",
								background: "#0f172a",
								minHeight: "100vh",
							}}
						>
							Loading...
						</div>
					}
				>
					<BrowserRouter>
						<App />
					</BrowserRouter>
				</Suspense>
			</ErrorBoundary>
		</JotaiProvider>,
	);

	// Remove the HTML bootstrap loader once React is mounted
	const initialLoader = document.getElementById("initial-loading");
	if (initialLoader) {
		initialLoader.style.opacity = "0";
		initialLoader.style.transition = "opacity 0.25s ease";
		window.setTimeout(() => initialLoader.remove(), 300);
	}

	// Ensure stale service workers/caches do not block fresh bundles
	if ("serviceWorker" in navigator) {
		navigator.serviceWorker
			.getRegistrations()
			.then((registrations) => Promise.all(registrations.map((reg) => reg.unregister())))
			.catch(() => {
				// ignore
			});
		if ("caches" in window) {
			caches
				.keys()
				.then((keys) =>
					keys.forEach((key) => {
						caches.delete(key);
					}),
				)
				.catch(() => {
					// ignore
				});
		}
	}
}
