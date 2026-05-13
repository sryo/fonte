export type TorrentStatus = 'adding' | 'downloading' | 'seeding' | 'paused' | 'completed' | 'error' | 'removed';

export interface TorrentRecord {
    id: string;
    infoHash: string;
    name: string;
    magnetUri?: string;
    status: TorrentStatus;
    progress: number;           // 0.0 to 1.0
    downloadSpeed: number;      // bytes/sec
    uploadSpeed: number;        // bytes/sec
    downloaded: number;         // bytes
    uploaded: number;           // bytes
    size: number;               // total bytes
    numPeers: number;
    savePath: string;
    files: TorrentFileRecord[];
    addedAt: number;            // epoch ms
    completedAt?: number;
    errorMessage?: string;
    tags?: string[];
}

export interface TorrentFileRecord {
    name: string;
    path: string;
    size: number;
    progress: number;
    selected: boolean;
}

export interface TorrentConfig {
    download_dir: string;
    max_concurrent: number;         // default: 5
    max_download_speed: number;     // bytes/sec, 0 = unlimited
    max_upload_speed: number;       // bytes/sec, 0 = unlimited
    seed_ratio_limit: number;       // default: 2.0, 0 = unlimited
    auto_start: boolean;            // default: true
    port: number;                   // default: 0 (random)
    dht: boolean;                   // default: true
}

export interface TorrentStats {
    downloadSpeed: number;
    uploadSpeed: number;
    activeTorrents: number;
    totalTorrents: number;
}

// Watchlist types
export type WatchlistStatus = 'watching' | 'fulfilled' | 'paused';
export type MediaType = 'movie' | 'tv';

export interface WatchlistRecord {
    id: string;
    title: string;
    mediaType: MediaType;
    year?: number;
    seasonPattern?: string;
    quality: string;
    searchQuery: string;
    category: number;
    enabled: boolean;
    status: WatchlistStatus;
    lastCheckedAt?: number;
    lastMatchAt?: number;
    matchedTorrentId?: string;
    posterUrl?: string;
    createdAt: number;
    updatedAt: number;
}

export interface WatchlistResultRecord {
    id: number;
    watchlistId: string;
    title: string;
    magnetUri: string;
    seeders: number;
    leechers: number;
    size: number;
    qualityMatch: number;
    publishDate?: number;
    indexer?: string;
    wasSelected: boolean;
    foundAt: number;
}

// Subtitle types
export type SubtitleStatus = 'pending' | 'downloading' | 'downloaded' | 'translating' | 'translated' | 'error';

export interface SubtitleRecord {
    id: number;
    torrentId: string;
    filePath: string;
    language: string;
    isOriginal: boolean;
    sourceSubtitleId?: number;
    status: SubtitleStatus;
    errorMessage?: string;
    createdAt: number;
    updatedAt: number;
}
