export const WATCHLIST_EVENTS = {
    SEARCH: 'watchlist:search',
    MATCH: 'watchlist:match',
    ADDED: 'watchlist:added',
    REMOVED: 'watchlist:removed',
    UPDATED: 'watchlist:updated',
} as const;

export const SUBTITLE_EVENTS = {
    DOWNLOADED: 'subtitle:downloaded',
    TRANSLATED: 'subtitle:translated',
    ERROR: 'subtitle:error',
} as const;
