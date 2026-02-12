import { useEffect, useState } from "react";

export function useIsMobile(breakpoint = 768) {
	const getIsMobile = () => (typeof window !== "undefined" ? window.innerWidth <= breakpoint : false);
	const [isMobile, setIsMobile] = useState(getIsMobile());

	useEffect(() => {
		const handleResize = () => setIsMobile(getIsMobile());
		if (typeof window !== "undefined") {
			window.addEventListener("resize", handleResize);
			return () => window.removeEventListener("resize", handleResize);
		}
		return () => {};
	}, [breakpoint]);

	return isMobile;
}
