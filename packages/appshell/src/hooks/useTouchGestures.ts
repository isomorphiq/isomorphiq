import { useEffect, useRef, useState } from "react";

interface TouchGesture {
	swipeLeft?: () => void;
	swipeRight?: () => void;
	swipeUp?: () => void;
	swipeDown?: () => void;
	tap?: () => void;
	longPress?: () => void;
	doubleTap?: () => void;
	pinch?: (scale: number) => void;
}

export function useTouchGestures(elementRef: React.RefObject<HTMLElement>, gestures: TouchGesture) {
	const [touchState, setTouchState] = useState({
		startX: 0,
		startY: 0,
		endX: 0,
		endY: 0,
		startTime: 0,
		longPressTimer: null as NodeJS.Timeout | null,
		tapCount: 0,
		lastTapTime: 0,
	});

	const SWIPE_THRESHOLD = 50;
	const LONG_PRESS_DELAY = 500;
	const DOUBLE_TAP_DELAY = 300;

	useEffect(() => {
		const element = elementRef.current;
		if (!element) return;

		const handleTouchStart = (e: TouchEvent) => {
			const touch = e.touches[0];
			const currentTime = Date.now();

			// Clear any existing long press timer
			if (touchState.longPressTimer) {
				clearTimeout(touchState.longPressTimer);
			}

			// Check for double tap
			if (currentTime - touchState.lastTapTime < DOUBLE_TAP_DELAY) {
				setTouchState((prev) => ({
					...prev,
					tapCount: prev.tapCount + 1,
					lastTapTime: currentTime,
				}));

				if (touchState.tapCount === 1) {
					if (gestures.doubleTap) {
						gestures.doubleTap();
					}
				}
			} else {
				setTouchState((prev) => ({
					...prev,
					tapCount: 1,
					lastTapTime: currentTime,
				}));
			}

			// Set long press timer
			const longPressTimer = setTimeout(() => {
				if (gestures.longPress) {
					gestures.longPress();
				}
			}, LONG_PRESS_DELAY);

			setTouchState((prev) => ({
				...prev,
				startX: touch.clientX,
				startY: touch.clientY,
				startTime: currentTime,
				longPressTimer,
			}));
		};

		const handleTouchMove = (e: TouchEvent) => {
			// Cancel long press if moved
			if (touchState.longPressTimer) {
				clearTimeout(touchState.longPressTimer);
				setTouchState((prev) => ({ ...prev, longPressTimer: null }));
			}

			const touch = e.touches[0];
			setTouchState((prev) => ({
				...prev,
				endX: touch.clientX,
				endY: touch.clientY,
			}));
		};

		const handleTouchEnd = (e: TouchEvent) => {
			// Clear long press timer
			if (touchState.longPressTimer) {
				clearTimeout(touchState.longPressTimer);
				setTouchState((prev) => ({ ...prev, longPressTimer: null }));
			}

			const touch = e.changedTouches[0];
			const endTime = Date.now();
			const timeDiff = endTime - touchState.startTime;

			const deltaX = touch.clientX - touchState.startX;
			const deltaY = touch.clientY - touchState.startY;
			const absDeltaX = Math.abs(deltaX);
			const absDeltaY = Math.abs(deltaY);

			// Determine if it's a swipe or tap
			if (timeDiff < 300 && (absDeltaX > SWIPE_THRESHOLD || absDeltaY > SWIPE_THRESHOLD)) {
				// It's a swipe
				if (absDeltaX > absDeltaY) {
					// Horizontal swipe
					if (deltaX > 0 && gestures.swipeRight) {
						gestures.swipeRight();
					} else if (deltaX < 0 && gestures.swipeLeft) {
						gestures.swipeLeft();
					}
				} else {
					// Vertical swipe
					if (deltaY > 0 && gestures.swipeDown) {
						gestures.swipeDown();
					} else if (deltaY < 0 && gestures.swipeUp) {
						gestures.swipeUp();
					}
				}
			} else if (timeDiff < 200 && absDeltaX < 10 && absDeltaY < 10) {
				// It's a tap (but not double tap)
				setTimeout(() => {
					if (touchState.tapCount === 1 && gestures.tap) {
						gestures.tap();
					}
					setTouchState((prev) => ({ ...prev, tapCount: 0 }));
				}, DOUBLE_TAP_DELAY);
			}

			setTouchState((prev) => ({
				...prev,
				endX: touch.clientX,
				endY: touch.clientY,
			}));
		};

		// Handle pinch gesture
		let initialDistance = 0;
		const handleTouchStartForPinch = (e: TouchEvent) => {
			if (e.touches.length === 2) {
				const touch1 = e.touches[0];
				const touch2 = e.touches[1];
				initialDistance = Math.hypot(
					touch2.clientX - touch1.clientX,
					touch2.clientY - touch1.clientY,
				);
			}
		};

		const handleTouchMoveForPinch = (e: TouchEvent) => {
			if (e.touches.length === 2 && gestures.pinch) {
				const touch1 = e.touches[0];
				const touch2 = e.touches[1];
				const currentDistance = Math.hypot(
					touch2.clientX - touch1.clientX,
					touch2.clientY - touch1.clientY,
				);

				if (initialDistance > 0) {
					const scale = currentDistance / initialDistance;
					gestures.pinch(scale);
				}
			}
		};

		element.addEventListener("touchstart", handleTouchStart, { passive: true });
		element.addEventListener("touchmove", handleTouchMove, { passive: true });
		element.addEventListener("touchend", handleTouchEnd, { passive: true });

		if (gestures.pinch) {
			element.addEventListener("touchstart", handleTouchStartForPinch, { passive: true });
			element.addEventListener("touchmove", handleTouchMoveForPinch, { passive: true });
		}

		return () => {
			element.removeEventListener("touchstart", handleTouchStart);
			element.removeEventListener("touchmove", handleTouchMove);
			element.removeEventListener("touchend", handleTouchEnd);

			if (gestures.pinch) {
				element.removeEventListener("touchstart", handleTouchStartForPinch);
				element.removeEventListener("touchmove", handleTouchMoveForPinch);
			}

			if (touchState.longPressTimer) {
				clearTimeout(touchState.longPressTimer);
			}
		};
	}, [elementRef, gestures, touchState]);

	return touchState;
}

// Hook for pull-to-refresh functionality
export function usePullToRefresh(onRefresh: () => Promise<void>, enabled: boolean = true) {
	const [isPulling, setIsPulling] = useState(false);
	const [pullDistance, setPullDistance] = useState(0);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const startY = useRef(0);
	const currentY = useRef(0);

	const PULL_THRESHOLD = 80;
	const MAX_PULL_DISTANCE = 120;

	useEffect(() => {
		if (!enabled) return;

		const handleTouchStart = (e: TouchEvent) => {
			if (window.scrollY === 0) {
				startY.current = e.touches[0].clientY;
				setIsPulling(true);
			}
		};

		const handleTouchMove = (e: TouchEvent) => {
			if (!isPulling) return;

			currentY.current = e.touches[0].clientY;
			const distance = Math.min(currentY.current - startY.current, MAX_PULL_DISTANCE);

			if (distance > 0) {
				e.preventDefault();
				setPullDistance(distance);
			}
		};

		const handleTouchEnd = async () => {
			if (!isPulling) return;

			setIsPulling(false);

			if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
				setIsRefreshing(true);
				try {
					await onRefresh();
				} finally {
					setIsRefreshing(false);
				}
			}

			setPullDistance(0);
		};

		document.addEventListener("touchstart", handleTouchStart, { passive: true });
		document.addEventListener("touchmove", handleTouchMove, { passive: false });
		document.addEventListener("touchend", handleTouchEnd, { passive: true });

		return () => {
			document.removeEventListener("touchstart", handleTouchStart);
			document.removeEventListener("touchmove", handleTouchMove);
			document.removeEventListener("touchend", handleTouchEnd);
		};
	}, [enabled, isPulling, pullDistance, isRefreshing, onRefresh]);

	return {
		isPulling,
		pullDistance,
		isRefreshing,
		pullProgress: Math.min(pullDistance / PULL_THRESHOLD, 1),
	};
}
