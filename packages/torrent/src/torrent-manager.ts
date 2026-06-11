import path from 'path';
import fs from 'fs';
import { log, emitEvent } from '@fonte/core';
import { genId } from '@fonte/core';
import { TorrentConfig, TorrentRecord, TorrentFileRecord, TorrentStats, TorrentStatus } from './types';
import { TORRENT_EVENTS } from './torrent-events';
import { TransmissionRpc } from './transmission-rpc';
import {
    initTorrentDb, closeTorrentDb,
    insertTorrent, updateTorrent, updateTorrentInfoHash, getTorrent, getTorrentByHash,
    getTorrents, getActiveTorrents, deleteTorrent,
    insertTorrentFiles, getTorrentFiles, updateTorrentFileProgress, setFileSelection,
} from './torrent-db';

const DEFAULT_CONFIG: TorrentConfig = {
    download_dir: path.join(require('os').homedir(), 'Downloads', 'fonte'),
    max_concurrent: 5,
    max_download_speed: 0,
    max_upload_speed: 0,
    seed_ratio_limit: 2.0,
    auto_start: true,
    port: 0,
    dht: true,
};

// ── Torrent Manager ───────────────────────────────────────────────────────────

export class TorrentManager {
    private rpc: TransmissionRpc | null = null;
    private config: TorrentConfig;
    private updateInterval: ReturnType<typeof setInterval> | null = null;
    private stalledTimers = new Map<string, number>();
    private stalledNotified = new Set<string>();
    // Map our internal IDs to Transmission torrent IDs
    private transmissionIds = new Map<string, number>();

    constructor(config?: Partial<TorrentConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    async start(): Promise<void> {
        if (this.rpc) return;

        if (!fs.existsSync(this.config.download_dir)) {
            fs.mkdirSync(this.config.download_dir, { recursive: true });
        }

        initTorrentDb();

        this.rpc = new TransmissionRpc();

        // Verify Transmission is running
        const available = await this.rpc.isAvailable();
        if (!available) {
            log('WARN', 'Transmission daemon not available at localhost:9091. Torrents will queue until it starts.');
        } else {
            // Configure Transmission with our settings
            await this.applyConfig();

            // Build mapping of existing torrents
            await this.buildTransmissionIdMap();
        }

        // Periodic sync
        this.updateInterval = setInterval(() => this.syncStats(), 3000);

        log('INFO', `TorrentManager started (Transmission RPC, download_dir=${this.config.download_dir})`);
    }

    async stop(): Promise<void> {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Final sync
        if (this.rpc) {
            try { await this.syncStats(); } catch {}
        }

        this.rpc = null;
        this.transmissionIds.clear();
        closeTorrentDb();
        log('INFO', 'TorrentManager stopped');
    }

    // ── Public Operations ─────────────────────────────────────────────────────

    async addTorrent(source: string | Buffer): Promise<TorrentRecord> {
        if (!this.rpc) throw new Error('TorrentManager not started');

        const id = genId('tor');
        const savePath = this.config.download_dir;

        let magnetUri: string | undefined;
        if (typeof source === 'string') {
            magnetUri = source;
        }

        const tempHash = typeof source === 'string'
            ? this.extractInfoHash(source) || id
            : id;

        // Check for duplicates
        const existing = getTorrentByHash(tempHash);
        if (existing && existing.status !== 'removed') {
            throw new Error(`Torrent already exists: ${existing.name || existing.infoHash} (${existing.id})`);
        }

        insertTorrent({ id, infoHash: tempHash, name: '', magnetUri, status: 'adding', savePath });

        // Add to Transmission
        try {
            const args: Record<string, any> = { 'download-dir': savePath, paused: false };

            if (typeof source === 'string') {
                if (source.startsWith('magnet:') || source.match(/^[a-fA-F0-9]{40}$/)) {
                    args.filename = source;
                } else if (fs.existsSync(source)) {
                    // .torrent file path — read and send as base64
                    const fileData = fs.readFileSync(source);
                    args.metainfo = fileData.toString('base64');
                } else {
                    args.filename = source;
                }
            } else {
                // Buffer — send as base64
                args.metainfo = source.toString('base64');
            }

            const result = await this.rpc.call('torrent-add', args);
            const added = result['torrent-added'] || result['torrent-duplicate'];

            if (added) {
                const tId = added.id as number;
                const hash = (added.hashString as string || '').toLowerCase();
                const name = added.name as string || '';

                this.transmissionIds.set(id, tId);

                if (hash && hash !== tempHash) {
                    updateTorrentInfoHash(id, hash);
                }
                if (name) {
                    updateTorrent(id, { name, status: 'downloading' });
                }

                // Fetch file list
                await this.syncTorrentFiles(id, tId);
            }
        } catch (err) {
            updateTorrent(id, { status: 'error', errorMessage: (err as Error).message });
            log('ERROR', `Failed to add torrent to Transmission: ${(err as Error).message}`);
            throw err;
        }

        emitEvent(TORRENT_EVENTS.ADDED, { id, infoHash: tempHash, magnetUri });
        return getTorrent(id)!;
    }

    async pauseTorrent(id: string): Promise<void> {
        const record = this.getRequiredTorrent(id);
        const tId = this.transmissionIds.get(id);
        if (tId !== undefined && this.rpc) {
            await this.rpc.call('torrent-stop', { ids: [tId] });
        }
        // If fully downloaded, mark as completed (not paused)
        const isComplete = record.progress >= 1;
        updateTorrent(id, {
            status: isComplete ? 'completed' : 'paused',
            downloadSpeed: 0,
            uploadSpeed: 0,
            ...(isComplete && !record.completedAt ? { completedAt: Date.now() } : {}),
        });
        emitEvent(isComplete ? TORRENT_EVENTS.COMPLETED : TORRENT_EVENTS.PAUSED, { id, name: record.name });
        log('INFO', `${isComplete ? 'Completed' : 'Paused'} torrent: ${record.name || id}`);
    }

    async resumeTorrent(id: string): Promise<void> {
        const record = this.getRequiredTorrent(id);
        const tId = this.transmissionIds.get(id);
        if (tId !== undefined && this.rpc) {
            await this.rpc.call('torrent-start', { ids: [tId] });
        }
        const newStatus: TorrentStatus = record.progress >= 1 ? 'seeding' : 'downloading';
        updateTorrent(id, { status: newStatus });
        emitEvent(TORRENT_EVENTS.RESUMED, { id, name: record.name });
        log('INFO', `Resumed torrent: ${record.name || id}`);
    }

    async removeTorrent(id: string, deleteFiles = false): Promise<void> {
        const record = this.getRequiredTorrent(id);
        const tId = this.transmissionIds.get(id);
        if (tId !== undefined && this.rpc) {
            await this.rpc.call('torrent-remove', { ids: [tId], 'delete-local-data': deleteFiles });
        }

        this.transmissionIds.delete(id);
        this.stalledTimers.delete(record.infoHash);

        if (deleteFiles) {
            deleteTorrent(id);
        } else {
            updateTorrent(id, { status: 'removed', downloadSpeed: 0, uploadSpeed: 0 });
        }

        emitEvent(TORRENT_EVENTS.REMOVED, { id, name: record.name, filesDeleted: deleteFiles });
        log('INFO', `Removed torrent: ${record.name || id} (files ${deleteFiles ? 'deleted' : 'kept'})`);
    }

    // ── Queries ────────────────────────────────────────────────────────────────

    getTorrent(id: string): TorrentRecord | undefined {
        return getTorrent(id);
    }

    getTorrents(filter?: { status?: TorrentStatus; limit?: number }): TorrentRecord[] {
        return getTorrents(filter);
    }

    getTorrentFiles(id: string): TorrentFileRecord[] {
        return getTorrentFiles(id);
    }

    async setFilesWanted(id: string, wanted: number[], unwanted: number[]): Promise<void> {
        if (!this.rpc) throw new Error('Transmission RPC not available');
        const tId = this.transmissionIds.get(id);
        if (!tId) throw new Error(`Torrent ${id} not mapped to Transmission`);
        const args: any = { ids: [tId] };
        if (wanted.length > 0) args['files-wanted'] = wanted;
        if (unwanted.length > 0) args['files-unwanted'] = unwanted;
        await this.rpc.call('torrent-set', args);
        // Refresh file selection from Transmission so DB matches
        await this.syncTorrentFiles(id, tId);
    }

    getStats(): TorrentStats {
        const all = getTorrents();
        const active = all.filter(t => t.status === 'downloading' || t.status === 'seeding');
        const downloadSpeed = all.reduce((s, t) => s + t.downloadSpeed, 0);
        const uploadSpeed = all.reduce((s, t) => s + t.uploadSpeed, 0);

        return { downloadSpeed, uploadSpeed, activeTorrents: active.length, totalTorrents: all.length };
    }

    getConfig(): TorrentConfig {
        return { ...this.config };
    }

    async updateConfig(partial: Partial<TorrentConfig>): Promise<void> {
        this.config = { ...this.config, ...partial };

        if (this.rpc) {
            await this.applyConfig();
        }

        log('INFO', 'Torrent config updated');
    }

    // ── Private Methods ───────────────────────────────────────────────────────

    private async applyConfig(): Promise<void> {
        if (!this.rpc) return;
        try {
            const args: Record<string, any> = {
                'download-dir': this.config.download_dir,
                'speed-limit-down-enabled': this.config.max_download_speed > 0,
                'speed-limit-down': Math.round(this.config.max_download_speed / 1024), // Transmission uses KB/s
                'speed-limit-up-enabled': this.config.max_upload_speed > 0,
                'speed-limit-up': Math.round(this.config.max_upload_speed / 1024),
                'seedRatioLimit': this.config.seed_ratio_limit,
                'seedRatioLimited': this.config.seed_ratio_limit > 0,
                'dht-enabled': this.config.dht,
                'download-queue-size': this.config.max_concurrent,
                'download-queue-enabled': true,
            };
            await this.rpc.call('session-set', args);
        } catch (err) {
            log('WARN', `Failed to apply config to Transmission: ${(err as Error).message}`);
        }
    }

    private async buildTransmissionIdMap(): Promise<void> {
        if (!this.rpc) return;
        try {
            const result = await this.rpc.call('torrent-get', {
                fields: ['id', 'hashString', 'name'],
            });
            const torrents = result.torrents || [];
            const dbTorrents = getActiveTorrents();

            for (const dbRecord of dbTorrents) {
                const match = torrents.find((t: any) =>
                    t.hashString?.toLowerCase() === dbRecord.infoHash?.toLowerCase()
                );
                if (match) {
                    this.transmissionIds.set(dbRecord.id, match.id);
                }
            }

            log('INFO', `Mapped ${this.transmissionIds.size} torrents to Transmission IDs`);
        } catch (err) {
            log('WARN', `Failed to build Transmission ID map: ${(err as Error).message}`);
        }
    }

    private async syncTorrentFiles(recordId: string, transmissionId: number): Promise<void> {
        if (!this.rpc) return;
        try {
            const result = await this.rpc.call('torrent-get', {
                ids: [transmissionId],
                fields: ['files', 'fileStats'],
            });
            const t = result.torrents?.[0];
            if (!t?.files) return;

            let existingFiles = getTorrentFiles(recordId);
            if (existingFiles.length === 0) {
                const files = t.files.map((f: any) => ({
                    name: path.basename(f.name),
                    path: f.name,
                    size: f.length || 0,
                }));
                insertTorrentFiles(recordId, files);
                existingFiles = getTorrentFiles(recordId);
            }

            // Refresh per-file progress + wanted state from Transmission, but only write when changed
            const byPath = new Map(existingFiles.map(f => [f.path, f]));
            const fileStats: any[] = t.fileStats || [];
            for (let i = 0; i < t.files.length; i++) {
                const f = t.files[i];
                const stats = fileStats[i];
                const progress = f.length > 0 ? (f.bytesCompleted || 0) / f.length : 0;
                const prev = byPath.get(f.name);
                if (!prev || Math.abs(prev.progress - progress) > 0.0001) {
                    updateTorrentFileProgress(recordId, f.name, progress);
                }
                if (stats && typeof stats.wanted === 'boolean' && (!prev || prev.selected !== stats.wanted)) {
                    setFileSelection(recordId, f.name, stats.wanted);
                }
            }
        } catch {}
    }

    private async syncStats(): Promise<void> {
        if (!this.rpc) return;

        let transmissionTorrents: any[];
        try {
            const result = await this.rpc.call('torrent-get', {
                fields: [
                    'id', 'hashString', 'name', 'status', 'percentDone',
                    'rateDownload', 'rateUpload', 'downloadedEver', 'uploadedEver',
                    'totalSize', 'peersConnected', 'error', 'errorString',
                ],
            });
            transmissionTorrents = result.torrents || [];
        } catch {
            return; // Transmission not available, skip sync
        }

        for (const t of transmissionTorrents) {
            const hash = (t.hashString as string || '').toLowerCase();
            const record = getTorrentByHash(hash);
            if (!record) continue;
            if (record.status === 'paused' || record.status === 'removed') continue;

            // Cache Transmission ID
            this.transmissionIds.set(record.id, t.id);

            const progress = t.percentDone ?? 0;
            const wasPending = record.status === 'downloading' || record.status === 'adding';
            const isDone = progress >= 1;

            // Map Transmission status: 0=stopped, 1=check-wait, 2=checking, 3=dl-wait, 4=downloading, 5=seed-wait, 6=seeding
            let newStatus: TorrentStatus = record.status;
            if (t.error && t.error > 0) {
                newStatus = 'error';
            } else if (isDone && wasPending) {
                newStatus = 'completed';
            } else if (t.status === 4 || t.status === 3) {
                newStatus = 'downloading';
            } else if (t.status === 6 || t.status === 5) {
                newStatus = 'seeding';
            } else if (record.status === 'adding' && t.name) {
                newStatus = 'downloading';
            }

            const updates: Parameters<typeof updateTorrent>[1] = {
                progress,
                downloadSpeed: t.rateDownload ?? 0,
                uploadSpeed: t.rateUpload ?? 0,
                downloaded: t.downloadedEver ?? 0,
                uploaded: t.uploadedEver ?? 0,
                numPeers: t.peersConnected ?? 0,
                size: t.totalSize || record.size,
                status: newStatus,
            };

            if (t.name && !record.name) {
                updates.name = t.name;
            }
            if (t.error && t.error > 0) {
                updates.errorMessage = t.errorString || 'Unknown error';
            }

            updateTorrent(record.id, updates);

            // Completion detection — only fire once per torrent
            if (isDone && wasPending && !record.completedAt) {
                updateTorrent(record.id, { completedAt: Date.now() });
                emitEvent(TORRENT_EVENTS.COMPLETED, { id: record.id, name: record.name || t.name });
                log('INFO', `Torrent completed: ${t.name}`);
            }

            // Stall detection — emit once per stall episode, re-arm when peers return
            if ((t.peersConnected ?? 0) > 0) {
                this.stalledTimers.set(hash, Date.now());
                this.stalledNotified.delete(hash);
            } else if (!isDone) {
                const lastHadPeers = this.stalledTimers.get(hash) ?? record.addedAt;
                if (Date.now() - lastHadPeers > 5 * 60 * 1000 && !this.stalledNotified.has(hash)) {
                    this.stalledNotified.add(hash);
                    emitEvent(TORRENT_EVENTS.STALLED, {
                        id: record.id,
                        name: record.name,
                        minutesWithoutPeers: Math.round((Date.now() - lastHadPeers) / 60000),
                    });
                }
            }

            // Sync files if missing
            const files = getTorrentFiles(record.id);
            if (files.length === 0) {
                await this.syncTorrentFiles(record.id, t.id);
            }
        }

        // Detect DB records missing from Transmission (removed externally)
        const transmissionHashes = new Set(transmissionTorrents.map((t: any) => (t.hashString || '').toLowerCase()));
        const activeDbRecords = getActiveTorrents();
        for (const record of activeDbRecords) {
            if (!transmissionHashes.has(record.infoHash.toLowerCase())) {
                updateTorrent(record.id, { status: 'removed', downloadSpeed: 0, uploadSpeed: 0 });
                this.transmissionIds.delete(record.id);
                log('INFO', `Torrent missing from Transmission, marked removed: ${record.name || record.id}`);
            }
        }

        emitEvent(TORRENT_EVENTS.STATS, this.getStats() as unknown as Record<string, unknown>);
    }

    private getRequiredTorrent(id: string): TorrentRecord {
        const record = getTorrent(id);
        if (!record) throw new Error(`Torrent not found: ${id}`);
        return record;
    }

    private extractInfoHash(magnetUri: string): string | undefined {
        const match = magnetUri.match(/xt=urn:btih:([a-fA-F0-9]{40})/);
        if (match) return match[1].toLowerCase();
        const b32Match = magnetUri.match(/xt=urn:btih:([A-Z2-7]{32})/i);
        if (b32Match) return b32Match[1].toLowerCase();
        return undefined;
    }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let instance: TorrentManager | null = null;

export function getTorrentManager(): TorrentManager {
    if (!instance) {
        instance = new TorrentManager();
    }
    return instance;
}

export function createTorrentManager(config?: Partial<TorrentConfig>): TorrentManager {
    instance = new TorrentManager(config);
    return instance;
}
