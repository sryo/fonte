import { Cron } from 'croner';
import { log, emitEvent, onEvent, enqueueMessage, insertAgentMessage, genId } from '@fonte/core';
import {
    getAutomationRule, getAutomationRules, updateAutomationRule, getEnabledEventIndex, onAutomationRulesChanged,
    beginAutomationRun, finishAutomationRun, setAutomationRunDetail, getAutomationRunByMessageId, getRunningAutomationRun,
    type AutomationRule, type AutomationRunTrigger, type AutomationRunStatus,
} from './automation-db';
import { triggerMembers } from './automation-trigger';
import { getTorrent } from './torrent-db';
import { AUTOMATION_EVENTS } from './automation-events';
import { buildWakePrompt, describeEventBatch, type WakeEvent } from './automation-prompt';
import { FailureCounter } from './failure-notices';

const EVENT_FIRE_DEBOUNCE_MS = 750;
const MAX_EVENTS_PER_WAKE = 25;
const MAX_QUEUED_EVENTS_PER_RULE = 500;
const AUTOMATION_MESSAGE_PREFIX = 'auto_';

export type FireOutcome = 'ok' | 'skipped' | 'error';

export interface AutomationEngineOptions {
    eventDebounceMs?: number;
    maxEventsPerWake?: number;
    maxQueuedEventsPerRule?: number;
}

interface PendingEvent extends WakeEvent {
    resolve: () => void;
}

interface EventBatch {
    items: PendingEvent[];
    timer: ReturnType<typeof setTimeout> | null;
    flushing: boolean;
}

function automationMessageId(ruleId: string, runId: string): string {
    return `${AUTOMATION_MESSAGE_PREFIX}${ruleId}_${runId}`;
}

export class AutomationEngine {
    private listening = false;
    private busSubscribed = false;
    private jobs = new Map<string, Cron[]>();
    private batches = new Map<string, EventBatch>();
    private failures = new FailureCounter();
    private unsubscribeRules: (() => void) | null = null;
    private readonly eventDebounceMs: number;
    private readonly maxEventsPerWake: number;
    private readonly maxQueuedEventsPerRule: number;

    constructor(options: AutomationEngineOptions = {}) {
        this.eventDebounceMs = options.eventDebounceMs ?? EVENT_FIRE_DEBOUNCE_MS;
        this.maxEventsPerWake = options.maxEventsPerWake ?? MAX_EVENTS_PER_WAKE;
        this.maxQueuedEventsPerRule = options.maxQueuedEventsPerRule ?? MAX_QUEUED_EVENTS_PER_RULE;
    }

    start(): void {
        if (this.listening) return;
        this.listening = true;
        if (!this.busSubscribed) {
            this.busSubscribed = true;
            onEvent((type, data) => this.onBusEvent(type, data));
        }
        this.unsubscribeRules = onAutomationRulesChanged(() => this.reloadJobs());
        this.reloadJobs();
        log('INFO', 'Automation engine started');
    }

    stop(): void {
        this.listening = false;
        this.unsubscribeRules?.();
        this.unsubscribeRules = null;
        this.stopJobs();
        for (const batch of this.batches.values()) {
            if (batch.timer) clearTimeout(batch.timer);
            for (const item of batch.items) item.resolve();
        }
        this.batches.clear();
        log('INFO', 'Automation engine stopped');
    }

    // ── Schedules ───────────────────────────────────────────────────────────

    reloadJobs(): void {
        this.stopJobs();
        if (!this.listening) return;
        for (const rule of getAutomationRules({ enabled: true })) {
            const jobs: Cron[] = [];
            for (const member of triggerMembers(rule.trigger)) {
                try {
                    if (member.type === 'cron') {
                        jobs.push(new Cron(member.schedule, () => { void this.fireById(rule.id, 'schedule'); }));
                    } else if (member.type === 'once') {
                        const at = new Date(member.runAt);
                        if (at.getTime() <= Date.now()) continue;
                        jobs.push(new Cron(at, () => { void this.fireById(rule.id, 'schedule'); }));
                    }
                } catch (err) {
                    log('ERROR', `Automation "${rule.name}": invalid schedule (${(err as Error).message})`);
                }
            }
            if (jobs.length > 0) this.jobs.set(rule.id, jobs);
        }
    }

    scheduledRuleIds(): string[] {
        return [...this.jobs.keys()];
    }

    private stopJobs(): void {
        for (const jobs of this.jobs.values()) for (const job of jobs) job.stop();
        this.jobs.clear();
    }

    private async fireById(ruleId: string, trigger: AutomationRunTrigger): Promise<void> {
        const rule = getAutomationRule(ruleId);
        if (!rule || !rule.enabled) return;
        try {
            await this.fire(rule, { trigger });
        } catch (err) {
            log('ERROR', `Automation "${rule.name}" failed to fire: ${(err as Error).message}`);
        }
    }

    // ── Events ──────────────────────────────────────────────────────────────

    private onBusEvent(type: string, data: Record<string, unknown>): void {
        if (!this.listening) return;
        if (type === 'agent:response' || type === 'agent:error' || type === 'agent:cancelled') {
            const messageId = typeof data.messageId === 'string' ? data.messageId : '';
            if (messageId.startsWith(AUTOMATION_MESSAGE_PREFIX)) this.closeRun(type, messageId, data);
            return;
        }
        if (type === 'agent:interrupted') {
            const messageId = typeof data.messageId === 'string' ? data.messageId : '';
            const run = messageId.startsWith(AUTOMATION_MESSAGE_PREFIX) ? getAutomationRunByMessageId(messageId) : undefined;
            if (run?.status === 'running') setAutomationRunDetail(run.id, typeof data.reason === 'string' ? data.reason : 'Paused, will resume');
            return;
        }
        this.evaluateEvent(type, data).catch(err => {
            log('ERROR', `Automation engine error: ${(err as Error).message}`);
        });
    }

    /** Resolves once every rule listening for this event has been woken (or the event was dropped). */
    async evaluateEvent(type: string, data: Record<string, unknown>): Promise<void> {
        if (!this.listening) return;
        if (type.startsWith('automation:')) return;
        const ruleIds = getEnabledEventIndex().get(type as any);
        if (!ruleIds || ruleIds.length === 0) return;
        await Promise.all(ruleIds.map(ruleId => this.enqueueEvent(ruleId, type, data)));
    }

    private enqueueEvent(ruleId: string, type: string, data: Record<string, unknown>): Promise<void> {
        return new Promise<void>((resolve) => {
            let batch = this.batches.get(ruleId);
            if (!batch) {
                batch = { items: [], timer: null, flushing: false };
                this.batches.set(ruleId, batch);
            }
            batch.items.push({ type, data, resolve });
            const excess = batch.items.length - this.maxQueuedEventsPerRule;
            if (excess > 0) {
                const dropped = batch.items.splice(0, excess);
                for (const item of dropped) item.resolve();
                log('WARN', `Automation ${ruleId}: dropped ${excess} queued event(s), the rule cannot keep up`);
            }
            this.scheduleFlush(ruleId, this.eventDebounceMs);
        });
    }

    private scheduleFlush(ruleId: string, delayMs: number): void {
        const batch = this.batches.get(ruleId);
        if (!batch || batch.items.length === 0 || batch.flushing || batch.timer) return;
        batch.timer = setTimeout(() => {
            batch.timer = null;
            void this.flushBatch(ruleId);
        }, delayMs);
    }

    private async flushBatch(ruleId: string): Promise<void> {
        const batch = this.batches.get(ruleId);
        if (!batch || batch.items.length === 0 || batch.flushing) return;
        batch.flushing = true;
        const items = batch.items.splice(0, this.maxEventsPerWake);
        try {
            const rule = getAutomationRule(ruleId);
            if (rule?.enabled && this.listening) {
                await this.fire(rule, { trigger: 'event', events: items.map(({ type, data }) => ({ type, data })) });
            }
        } catch (err) {
            log('ERROR', `Automation ${ruleId} failed: ${(err as Error).message}`);
        } finally {
            for (const item of items) item.resolve();
            batch.flushing = false;
            if (batch.items.length > 0) this.scheduleFlush(ruleId, 0);
            else this.batches.delete(ruleId);
        }
    }

    // ── Firing ──────────────────────────────────────────────────────────────

    async fire(rule: AutomationRule, opts: { trigger: AutomationRunTrigger; events?: WakeEvent[] }): Promise<FireOutcome> {
        const events = (opts.events ?? []).map(hydrateEvent);
        const isEventFire = opts.trigger === 'event' && events.length > 0;

        if (!isEventFire && getRunningAutomationRun(rule.id)) {
            const runId = genId('run');
            beginAutomationRun({
                id: runId, ruleId: rule.id, trigger: opts.trigger, messageId: `skipped_${runId}`,
                status: 'skipped', detail: 'Previous run still in progress',
            });
            log('INFO', `Automation "${rule.name}" skipped: previous run still in progress`);
            emitEvent(AUTOMATION_EVENTS.FINISHED, { ruleId: rule.id, ruleName: rule.name, runId, status: 'skipped' });
            return 'skipped';
        }

        const runId = genId('run');
        const messageId = automationMessageId(rule.id, runId);
        const now = Date.now();
        const summary = isEventFire
            ? describeEventBatch(events)
            : opts.trigger === 'manual' ? 'Run on demand' : rule.triggerDescription;
        const prompt = buildWakePrompt(rule, { trigger: opts.trigger, events, firedAt: now });

        beginAutomationRun({ id: runId, ruleId: rule.id, trigger: opts.trigger, messageId, eventSummary: summary });
        insertAgentMessage({
            agentId: rule.agentId, role: 'user', channel: 'automation', sender: 'Automation', messageId, kind: 'event',
            content: JSON.stringify({ event: 'automation-fired', ruleId: rule.id, ruleName: rule.name, trigger: opts.trigger, summary }),
        });
        const rowId = enqueueMessage({
            channel: 'automation',
            sender: 'Automation',
            message: prompt,
            messageId,
            agent: rule.agentId,
            lane: 'background',
        });
        if (rowId === null) {
            finishAutomationRun(runId, 'error', 'Duplicate message id');
            return 'error';
        }

        updateAutomationRule(rule.id, { lastTriggeredAt: now, triggerCount: rule.triggerCount + 1 });
        if (opts.trigger === 'schedule' && rule.trigger.type === 'once') {
            updateAutomationRule(rule.id, { enabled: false });
        }

        emitEvent(AUTOMATION_EVENTS.EXECUTED, {
            ruleId: rule.id,
            ruleName: rule.name,
            runId,
            trigger: opts.trigger,
            triggerEvent: events[0]?.type ?? opts.trigger,
            eventCount: events.length,
        });
        log('INFO', `Automation "${rule.name}" fired (${opts.trigger}${isEventFire ? `, ${events.length} event${events.length === 1 ? '' : 's'}` : ''}) → @${rule.agentId}`);
        return 'ok';
    }

    private closeRun(type: string, messageId: string, data: Record<string, unknown>): void {
        const run = getAutomationRunByMessageId(messageId);
        if (!run || run.status !== 'running') return;

        let status: Exclude<AutomationRunStatus, 'running'>;
        let detail: string | undefined;
        if (type === 'agent:response') {
            status = 'ok';
            detail = data.quiet ? 'Nothing to report' : excerpt(data.content);
        } else if (type === 'agent:cancelled') {
            status = 'interrupted';
            detail = typeof data.reason === 'string' ? data.reason : 'Interrupted before it finished';
        } else {
            status = 'error';
            detail = typeof data.error === 'string' && data.error ? data.error : 'The agent run failed';
        }
        finishAutomationRun(run.id, status, detail);

        const rule = getAutomationRule(run.ruleId);
        const ruleName = rule?.name ?? run.ruleId;
        if (status === 'ok') this.clearFailures(run.ruleId);
        if (status === 'error') this.recordFailure(run.ruleId, ruleName, detail ?? '');
        emitEvent(AUTOMATION_EVENTS.FINISHED, { ruleId: run.ruleId, ruleName, runId: run.id, status, detail: detail ?? null });
    }

    private recordFailure(ruleId: string, ruleName: string, detail: string): void {
        const { occurrence, notify } = this.failures.record(ruleId, detail);
        emitEvent(AUTOMATION_EVENTS.FAILED, { ruleId, ruleName, detail, occurrence, notify });
        log('ERROR', `Automation "${ruleName}" failed (occurrence ${occurrence}): ${detail}`);
    }

    private clearFailures(ruleId: string): void {
        this.failures.clear(ruleId);
    }
}

function hydrateEvent(event: WakeEvent): WakeEvent {
    const data = { ...event.data };
    if (event.type.startsWith('torrent:') && typeof data.id === 'string') {
        const torrent = getTorrent(data.id);
        if (torrent) Object.assign(data, torrent, data);
    }
    return { type: event.type, data };
}

function excerpt(content: unknown): string | undefined {
    if (typeof content !== 'string') return undefined;
    const text = content.replace(/\s+/g, ' ').trim();
    return text || undefined;
}

let engine: AutomationEngine | null = null;
export function getAutomationEngine(): AutomationEngine {
    if (!engine) engine = new AutomationEngine();
    return engine;
}
export function createAutomationEngine(options?: AutomationEngineOptions): AutomationEngine {
    engine = new AutomationEngine(options);
    return engine;
}
