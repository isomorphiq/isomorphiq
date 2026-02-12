import { useEffect, useState } from "react";

export function useRegistrationStatus(): { registrationDisabled: boolean; statusLoaded: boolean } {
	const [registrationDisabled, setRegistrationDisabled] = useState(false);
	const [statusLoaded, setStatusLoaded] = useState(false);

	useEffect(() => {
		let isActive = true;

		const load = async () => {
			try {
				const response = await fetch("/api/auth/registration-status");
				const data = await response.json();
				if (isActive) {
					setRegistrationDisabled(Boolean(data?.disabled));
					setStatusLoaded(true);
				}
			} catch (_error) {
				if (isActive) {
					setStatusLoaded(true);
				}
			}
		};

		load();

		return () => {
			isActive = false;
		};
	}, []);

	return { registrationDisabled, statusLoaded };
}
