import { log, emitEvent, onEvent, enqueueMessage } from '@aitorrent/core';
import { getAutomationRules, updateAutomationRule, insertAutomationLog } from './automation-db';
import { getTorrent } from './torrent-db';
import { AUTOMATION_EVENTS } from './automation-events';
import type { AutomationRule } from './automation-db';

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
        // Build context from event data
        const context = this.buildEventContext(eventType, data);
        const fullMessage = `${context}\n\nAutomation instruction: ${rule.prompt}`;

        // Send to agent
        enqueueMessage({
            channel: 'automation',
            sender: 'Automation',
            message: fullMessage,
            messageId: `auto_${rule.id}_${Date.now()}`,
            agent: 'aitorrent',
        });

        // Update rule stats
        updateAutomationRule(rule.id, {
            lastTriggeredAt: Date.now(),
            triggerCount: rule.triggerCount + 1,
        });

        insertAutomationLog({
            ruleId: rule.id,
            triggerEvent: eventType,
            conditionsMet: true,
            actionsExecuted: ['prompt_sent'],
        });

        emitEvent(AUTOMATION_EVENTS.EXECUTED, {
            ruleId: rule.id,
            ruleName: rule.name,
            triggerEvent: eventType,
        });

        log('INFO', `Automation "${rule.name}" triggered → agent`);
    }

    private buildEventContext(type: string, data: Record<string, unknown>): string {
        // Enrich with torrent record if available
        if (data.id) {
            const torrent = getTorrent(data.id as string);
            if (torrent) {
                Object.assign(data, torrent);
            }
        }

        switch (type) {
            case 'torrent:completed':
                return `Torrent "${data.name}" completed. Size: ${data.size} bytes. Saved to: ${data.savePath}. Torrent ID: ${data.id}.`;
            case 'torrent:added':
                return `New torrent added: "${data.name}". Torrent ID: ${data.id}.`;
            case 'torrent:error':
                return `Torrent "${data.name}" failed with error: ${data.errorMessage || data.error}. Torrent ID: ${data.id}.`;
            case 'torrent:stalled':
                return `Torrent "${data.name}" has been stalled for ${data.minutesWithoutPeers} minutes with no peers. Torrent ID: ${data.id}.`;
            case 'watchlist:match':
                return `Watchlist match found for "${data.title}". Torrent "${data.torrentName}" was auto-added. Torrent ID: ${data.torrentId}.`;
            case 'schedule':
                return `Scheduled automation triggered at ${new Date().toISOString()}.`;
            default:
                return `Event "${type}" fired. Data: ${JSON.stringify(data)}`;
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
