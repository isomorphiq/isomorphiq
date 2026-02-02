export const getTimeframeMinutes = (timeframe: string): number => {
    const timeframeMap: Record<string, number> = {
        "1m": 1,
        "5m": 5,
        "15m": 15,
        "1h": 60,
        "6h": 360,
        "24h": 1440
    };

    return timeframeMap[timeframe] || 15;
};
