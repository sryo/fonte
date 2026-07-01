export const TORRENT_EVENTS = {
    ADDED: 'torrent:added',
    PROGRESS: 'torrent:progress',
    COMPLETED: 'torrent:completed',
    PAUSED: 'torrent:paused',
    RESUMED: 'torrent:resumed',
    REMOVED: 'torrent:removed',
    ERROR: 'torrent:error',
    STATS: 'torrent:stats',
    STALLED: 'torrent:stalled',
    METADATA: 'torrent:metadata',
    VERIFYING: 'torrent:verifying',
    REANNOUNCED: 'torrent:reannounced',
} as const;
