import { useEffect, useState } from "react";
import type { Location } from "react-router-dom";

export function useRouteProgress(_location: Location) {
	const [routeLoading, setRouteLoading] = useState(false);

	useEffect(() => {
		setRouteLoading(true);
		const timeout = window.setTimeout(() => setRouteLoading(false), 240);
		return () => window.clearTimeout(timeout);
	}, []);

	return routeLoading;
}
