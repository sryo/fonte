import { Cron } from 'croner';

export const AUTOMATION_EVENT_NAMES = [
    'torrent:completed', 'torrent:added', 'torrent:error', 'torrent:stalled', 'torrent:removed',
    'watchlist:match', 'watchlist:search', 'watchlist:results',
    'subtitle:downloaded', 'subtitle:translated',
] as const;
export type AutomationEventName = typeof AUTOMATION_EVENT_NAMES[number];

export const AUTOMATION_EVENT_LABELS: Record<AutomationEventName, string> = {
    'torrent:completed': 'a torrent completes',
    'torrent:added': 'a torrent is added',
    'torrent:error': 'a torrent errors',
    'torrent:stalled': 'a torrent stalls',
    'torrent:removed': 'a torrent is removed',
    'watchlist:match': 'a watchlist match is added',
    'watchlist:search': 'a watchlist entry is searched',
    'watchlist:results': 'a watchlist entry gets new results',
    'subtitle:downloaded': 'subtitles are downloaded',
    'subtitle:translated': 'subtitles are translated',
};

export interface EventTrigger { type: 'event'; event: AutomationEventName }
export interface CronTrigger { type: 'cron'; schedule: string }
export interface OnceTrigger { type: 'once'; runAt: string }
export type TriggerMember = EventTrigger | CronTrigger | OnceTrigger;
export interface GroupTrigger { type: 'group'; members: TriggerMember[] }
export type AutomationTrigger = TriggerMember | GroupTrigger;

const MAX_GROUP_MEMBERS = 8;

function isAutomationEventName(value: unknown): value is AutomationEventName {
    return typeof value === 'string' && (AUTOMATION_EVENT_NAMES as readonly string[]).includes(value);
}

function normalizeCron(schedule: string): string {
    return schedule.trim().replace(/\s+/g, ' ');
}

export function isValidCron(schedule: string): boolean {
    const normalized = normalizeCron(schedule);
    if (normalized.split(' ').length !== 5) return false;
    try {
        new Cron(normalized).stop();
        return true;
    } catch {
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMember(value: unknown): TriggerMember | null {
    if (!isRecord(value)) return null;
    if (value.type === 'event') {
        return isAutomationEventName(value.event) ? { type: 'event', event: value.event } : null;
    }
    if (value.type === 'cron') {
        if (typeof value.schedule !== 'string' || !isValidCron(value.schedule)) return null;
        return { type: 'cron', schedule: normalizeCron(value.schedule) };
    }
    if (value.type === 'once') {
        if (typeof value.runAt !== 'string') return null;
        const d = new Date(value.runAt);
        if (isNaN(d.getTime())) return null;
        return { type: 'once', runAt: d.toISOString() };
    }
    return null;
}

/**
 * Validate and normalize a trigger from any wire shape: a member, a group, or a
 * bare array (group shorthand). A group of one collapses to its member.
 */
export function parseTrigger(value: unknown): AutomationTrigger | null {
    const rawMembers: unknown[] | null = Array.isArray(value)
        ? value
        : isRecord(value) && value.type === 'group'
            ? (Array.isArray(value.members) ? value.members : null)
            : null;
    if (rawMembers === null) return parseMember(value);
    if (rawMembers.length === 0 || rawMembers.length > MAX_GROUP_MEMBERS) return null;
    const members: TriggerMember[] = [];
    for (const raw of rawMembers) {
        const member = parseMember(raw);
        if (!member) return null;
        if (!members.some(m => JSON.stringify(m) === JSON.stringify(member))) members.push(member);
    }
    return members.length === 1 ? members[0] : { type: 'group', members };
}

export function parseLegacyTrigger(triggerType: unknown, triggerConfig: unknown): AutomationTrigger | null {
    if (triggerType === 'schedule') {
        const cron = isRecord(triggerConfig) ? triggerConfig.cron : undefined;
        return typeof cron === 'string' && isValidCron(cron) ? { type: 'cron', schedule: normalizeCron(cron) } : null;
    }
    return isAutomationEventName(triggerType) ? { type: 'event', event: triggerType } : null;
}

export function triggerMembers(trigger: AutomationTrigger): TriggerMember[] {
    return trigger.type === 'group' ? trigger.members : [trigger];
}

export function triggerEvents(trigger: AutomationTrigger): AutomationEventName[] {
    return triggerMembers(trigger).flatMap(m => m.type === 'event' ? [m.event] : []);
}

/** Value for the pre-trigger `trigger_type` column, which older readers still expect. */
export function triggerTypeColumn(trigger: AutomationTrigger): string {
    return trigger.type === 'event' ? trigger.event : trigger.type;
}

export function nextRunAt(trigger: AutomationTrigger, now: number = Date.now()): number | null {
    let earliest: number | null = null;
    for (const member of triggerMembers(trigger)) {
        let next: number | null = null;
        if (member.type === 'cron') {
            try {
                const job = new Cron(member.schedule);
                next = job.nextRun(new Date(now))?.getTime() ?? null;
                job.stop();
            } catch {
                next = null;
            }
        } else if (member.type === 'once') {
            const at = new Date(member.runAt).getTime();
            next = at > now ? at : null;
        }
        if (next !== null && (earliest === null || next < earliest)) earliest = next;
    }
    return earliest;
}

// ── Descriptions ─────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function clock(hour: number, minute: number): string {
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

function ordinal(n: number): string {
    const v = n % 100;
    if (v >= 11 && v <= 13) return `${n}th`;
    switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
    }
}

function joinAnd(parts: string[]): string {
    if (parts.length <= 1) return parts[0] ?? '';
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

const INT = /^\d+$/;

/** Plain words for the cron shapes the editor produces; anything else is returned as-is. */
export function describeCron(schedule: string): string {
    const fields = normalizeCron(schedule).split(' ');
    if (fields.length !== 5) return schedule;
    const [min, hour, dom, mon, dow] = fields;
    if (mon !== '*') return schedule;

    const step = /^\*\/(\d+)$/.exec(min);
    if (step && hour === '*' && dom === '*' && dow === '*') {
        return `Every ${step[1]} minutes`;
    }
    if (INT.test(min) && hour === '*' && dom === '*' && dow === '*') {
        return Number(min) === 0 ? 'Every hour' : `Every hour at :${min.padStart(2, '0')}`;
    }
    if (!INT.test(min) || !INT.test(hour)) return schedule;
    const time = clock(Number(hour), Number(min));

    if (dom === '*' && dow === '*') return `Every day at ${time}`;
    if (dom === '*' && dow === '1-5') return `Weekdays at ${time}`;
    if (dom === '*' && (dow === '0,6' || dow === '6,0')) return `Weekends at ${time}`;
    if (dom === '*' && /^\d(,\d)*$/.test(dow)) {
        const days = dow.split(',').map(Number).map(d => DAY_NAMES[d === 7 ? 0 : d]).filter(Boolean);
        return `Every ${joinAnd(days)} at ${time}`;
    }
    if (dow === '*' && INT.test(dom)) return `Monthly on the ${ordinal(Number(dom))} at ${time}`;
    return schedule;
}

function describeOnce(runAt: string): string {
    const d = new Date(runAt);
    if (isNaN(d.getTime())) return `Once at ${runAt}`;
    return `Once on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${clock(d.getHours(), d.getMinutes())}`;
}

export function describeMember(member: TriggerMember): string {
    switch (member.type) {
        case 'event': return `When ${AUTOMATION_EVENT_LABELS[member.event]}`;
        case 'cron': return describeCron(member.schedule);
        case 'once': return describeOnce(member.runAt);
    }
}

export function describeTrigger(trigger: AutomationTrigger): string {
    return triggerMembers(trigger)
        .map(describeMember)
        .map((text, i) => i === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1))
        .join(' or ');
}
