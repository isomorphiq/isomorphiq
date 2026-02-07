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
export declare function useTouchGestures(elementRef: React.RefObject<HTMLElement>, gestures: TouchGesture): {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    startTime: number;
    longPressTimer: NodeJS.Timeout | null;
    tapCount: number;
    lastTapTime: number;
};
export declare function usePullToRefresh(onRefresh: () => Promise<void>, enabled?: boolean): {
    isPulling: boolean;
    pullDistance: number;
    isRefreshing: boolean;
    pullProgress: number;
};
export {};
