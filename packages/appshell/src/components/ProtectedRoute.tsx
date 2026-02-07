import { useAtom } from "jotai";
import { Navigate } from "react-router-dom";
import { authAtom } from "../authAtoms.ts";

interface ProtectedRouteProps {
	children: React.ReactNode;
	requireAuth?: boolean;
}

export function ProtectedRoute({ children, requireAuth = true }: ProtectedRouteProps) {
	const [auth] = useAtom(authAtom);

	if (requireAuth && !auth.isAuthenticated) {
		return <Navigate to="/login" replace />;
	}

	if (!requireAuth && auth.isAuthenticated) {
		return <Navigate to="/overview" replace />;
	}

	return <>{children}</>;
}
