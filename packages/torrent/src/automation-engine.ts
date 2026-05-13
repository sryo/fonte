import fs from 'fs';
import path from 'path';
import { log, emitEvent, onEvent } from '@aitorrent/core';
import { getAutomationRules, updateAutomationRule, insertAutomationLog } from './automation-db';
import { getTorrentManager } from './torrent-manager';
import { fetchSubtitlesForTorrent, translateSubtitle, parseTorrentName } from './subtitle-manager';
import { getTorrent, getTorrentFiles, updateTorrent } from './torrent-db';
import { AUTOMATION_EVENTS } from './automation-events';
import type { AutomationRule, AutomationCondition, AutomationAction } from './automation-db';

export class AutomationEngine {
    private listening = false;

    start(): void {
        if (this.listening) return;
        this.listening = true;
        onEvent((type, data) => {
            this.evaluateEvent(type, data).catch(err => {
                log('ERROR', `Automation engine error: ${(err as Error).message}`);
            });
        });
        log('INFO', 'Automation engine started');
    }

    stop(): void {
        this.listening = false;
        log('INFO', 'Automation engine stopped');
    }

    async evaluateEvent(type: string, data: Record<string, unknown>): Promise<void> {
        if (!this.listening) return;
        // Don't trigger on our own events (avoid loops)
        if (type.startsWith('automation:')) return;

        const rules = getAutomationRules({ enabled: true, triggerType: type });
        for (const rule of rules) {
            try {
                await this.executeRule(rule, type, data);
            } catch (err) {
                insertAutomationLog({
                    ruleId: rule.id,
                    triggerEvent: type,
                    conditionsMet: false,
                    errorMessage: (err as Error).message,
                });
                log('ERROR', `Automation "${rule.name}" failed: ${(err as Error).message}`);
            }
        }
    }

    private async executeRule(rule: AutomationRule, eventType: string, data: Record<string, unknown>): Promise<void> {
        // Check conditions
        if (!this.checkConditions(rule.conditions, data)) {
            insertAutomationLog({
                ruleId: rule.id,
                triggerEvent: eventType,
                conditionsMet: false,
            });
            return;
        }

        // Execute actions
        const executed: string[] = [];
        for (const action of rule.actions) {
            try {
                await this.executeAction(action, data);
                executed.push(action.type);
            } catch (err) {
                insertAutomationLog({
                    ruleId: rule.id,
                    triggerEvent: eventType,
                    conditionsMet: true,
                    actionsExecuted: executed,
                    errorMessage: `Action ${action.type} failed: ${(err as Error).message}`,
                });
                throw err;
            }
        }

        // Log success
        updateAutomationRule(rule.id, {
            lastTriggeredAt: Date.now(),
            triggerCount: rule.triggerCount + 1,
        });
        insertAutomationLog({
            ruleId: rule.id,
            triggerEvent: eventType,
            conditionsMet: true,
            actionsExecuted: executed,
        });

        emitEvent(AUTOMATION_EVENTS.EXECUTED, {
            ruleId: rule.id,
            ruleName: rule.name,
            triggerEvent: eventType,
            actionsExecuted: executed,
        });

        log('INFO', `Automation "${rule.name}" executed: ${executed.join(' → ')}`);
    }

    private checkConditions(conditions: AutomationCondition[], data: Record<string, unknown>): boolean {
        // If no conditions, always pass
        if (conditions.length === 0) return true;

        // Enrich data with torrent record if we have an ID
        let enrichedData = { ...data };
        if (data.id) {
            const torrent = getTorrent(data.id as string);
            if (torrent) {
                enrichedData = { ...enrichedData, ...torrent };
            }
        }

        return conditions.every(c => {
            const fieldValue = enrichedData[c.field];
            if (fieldValue === undefined) return false;

            switch (c.operator) {
                case 'eq': return String(fieldValue) === String(c.value);
                case 'neq': return String(fieldValue) !== String(c.value);
                case 'contains': return String(fieldValue).toLowerCase().includes(String(c.value).toLowerCase());
                case 'gt': return Number(fieldValue) > Number(c.value);
                case 'lt': return Number(fieldValue) < Number(c.value);
                case 'gte': return Number(fieldValue) >= Number(c.value);
                case 'lte': return Number(fieldValue) <= Number(c.value);
                default: return false;
            }
        });
    }

    private async executeAction(action: AutomationAction, data: Record<string, unknown>): Promise<void> {
        const manager = getTorrentManager();
        const torrentId = data.id as string | undefined;

        switch (action.type) {
            case 'fetch_subtitles':
                if (torrentId) await fetchSubtitlesForTorrent(torrentId);
                break;
            case 'translate_subtitles':
                if (action.config.subtitleId) {
                    await translateSubtitle(action.config.subtitleId as number, action.config.language as string || 'en');
                }
                break;
            case 'pause_torrent':
                if (torrentId) await manager.pauseTorrent(torrentId);
                break;
            case 'resume_torrent':
                if (torrentId) await manager.resumeTorrent(torrentId);
                break;
            case 'remove_torrent':
                if (torrentId) await manager.removeTorrent(torrentId, !!action.config.deleteFiles);
                break;
            case 'notify_webhook':
                if (action.config.url) {
                    await fetch(action.config.url as string, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ event: data, rule: action }),
                        signal: AbortSignal.timeout(10000),
                    });
                }
                break;
            case 'rename_files': {
                if (!torrentId) break;
                const torrent = getTorrent(torrentId);
                if (!torrent) break;
                const files = getTorrentFiles(torrentId);
                const parsed = parseTorrentName(torrent.name);
                for (const file of files) {
                    const oldPath = path.join(torrent.savePath, file.path);
                    if (!fs.existsSync(oldPath)) continue;
                    const ext = path.extname(file.name);
                    const epMatch = torrent.name.match(/S\d{2}E\d{2}/i);
                    const cleanName = parsed.isTv
                        ? `${parsed.title}${epMatch ? ' ' + epMatch[0] : ''}${ext}`
                        : `${parsed.title}${parsed.year ? ' (' + parsed.year + ')' : ''}${ext}`;
                    const newPath = path.join(path.dirname(oldPath), cleanName.trim());
                    if (oldPath !== newPath) {
                        fs.renameSync(oldPath, newPath);
                        log('INFO', `Renamed: ${file.name} → ${cleanName.trim()}`);
                    }
                }
                break;
            }

            case 'move_to_folder': {
                if (!torrentId || !action.config.targetFolder) break;
                const torrent = getTorrent(torrentId);
                if (!torrent) break;
                const target = action.config.targetFolder as string;
                if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
                const files = getTorrentFiles(torrentId);
                for (const file of files) {
                    const oldPath = path.join(torrent.savePath, file.path);
                    if (!fs.existsSync(oldPath)) continue;
                    const newPath = path.join(target, file.name);
                    fs.renameSync(oldPath, newPath);
                    log('INFO', `Moved: ${file.name} → ${target}`);
                }
                break;
            }

            case 'organize_by_type': {
                if (!torrentId) break;
                const torrent = getTorrent(torrentId);
                if (!torrent) break;
                const parsed = parseTorrentName(torrent.name);
                const baseDir = (action.config.baseDir as string) || path.dirname(torrent.savePath);
                const typeFolder = parsed.isTv ? 'TV' : 'Movies';
                const target = path.join(baseDir, typeFolder);
                if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
                const files = getTorrentFiles(torrentId);
                for (const file of files) {
                    const oldPath = path.join(torrent.savePath, file.path);
                    if (!fs.existsSync(oldPath)) continue;
                    const newPath = path.join(target, file.name);
                    fs.renameSync(oldPath, newPath);
                }
                log('INFO', `Organized "${torrent.name}" → ${typeFolder}/`);
                break;
            }

            default:
                log('WARN', `Unknown action type: ${action.type}`);
        }
    }
}

// Singleton
let engine: AutomationEngine | null = null;
export function getAutomationEngine(): AutomationEngine {
    if (!engine) engine = new AutomationEngine();
    return engine;
}
export function createAutomationEngine(): AutomationEngine {
    engine = new AutomationEngine();
    return engine;
}
