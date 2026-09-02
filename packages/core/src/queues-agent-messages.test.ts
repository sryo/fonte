import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

let tmpHome: string;
let q: typeof import('./queues');

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-queues-test-'));
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true });
    process.env.FONTE_HOME = tmpHome;
    q = await import('./queues');
    q.initQueueDb();
});

afterAll(() => {
    q.closeQueueDb();
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
    // Wipe through the public API surface: no getDb export by design.
    for (const m of q.getAgentMessages('a', 1000)) q.deleteAgentMessagesFrom('a', m.id);
});

const row = (messageId: string, role: 'user' | 'assistant', content: string, kind = 'text') =>
    q.insertAgentMessage({ agentId: 'a', role, channel: 'web', sender: 's', messageId, content, kind });

describe('agent message helpers', () => {
    it('deletes one turn by message id, optionally one role only', () => {
        row('m1', 'user', 'hi');
        row('m1', 'assistant', '[quiet]');
        row('m1', 'assistant', '[quiet]');
        row('m2', 'assistant', 'other');
        expect(q.deleteAgentMessagesByMessageId('a', 'm1', 'assistant')).toBe(2);
        expect(q.getAgentMessages('a').map(m => m.content).sort()).toEqual(['hi', 'other']);
        expect(q.deleteAgentMessagesByMessageId('a', 'm1')).toBe(1);
        expect(q.getAgentMessages('a')).toHaveLength(1);
    });

    it('marks a tool row settled by its tool-use id', () => {
        row('m1', 'assistant', JSON.stringify({ name: 'Bash', input: { command: 'ls' }, toolUseId: 'toolu_1' }), 'tool');
        row('m1', 'assistant', JSON.stringify({ name: 'Read', input: {}, toolUseId: 'toolu_2' }), 'tool');
        expect(q.updateAgentToolMessage('a', 'm1', 'toolu_1', { status: 'failed' })).toBe(true);
        expect(q.updateAgentToolMessage('a', 'm1', 'toolu_9', { status: 'done' })).toBe(false);
        const tools = q.getAgentMessages('a').map(m => JSON.parse(m.content));
        expect(tools.find(t => t.toolUseId === 'toolu_1').status).toBe('failed');
        expect(tools.find(t => t.toolUseId === 'toolu_2').status).toBeUndefined();
    });

    it('pages with since_id before the limit', () => {
        const ids = ['m1', 'm2', 'm3'].map(id => row(id, 'user', id));
        expect(q.getAgentMessages('a', 1, ids[0]).map(m => m.content)).toEqual(['m3']);
        expect(q.getAgentMessages('a', 10, ids[1]).map(m => m.content)).toEqual(['m3']);
    });
});

describe('lanes', () => {
    it('claims user-lane rows before older background rows', () => {
        q.enqueueMessage({ channel: 'automation', sender: 'Automation', message: 'bg', messageId: 'bg1', agent: 'lane-agent', lane: 'background' });
        q.enqueueMessage({ channel: 'web', sender: 'Web', message: 'user', messageId: 'u1', agent: 'lane-agent' });
        expect(q.oldestPendingUserMessageAge('lane-agent')).toBeGreaterThanOrEqual(0);
        expect(q.claimNextPendingMessage('lane-agent').message_id).toBe('u1');
        expect(q.oldestPendingUserMessageAge('lane-agent')).toBeNull();
        expect(q.claimNextPendingMessage('lane-agent').message_id).toBe('bg1');
        expect(q.claimNextPendingMessage('lane-agent')).toBeNull();
    });

    it('interrupts a processing row back to pending without touching retries', () => {
        q.enqueueMessage({ channel: 'automation', sender: 'Automation', message: 'bg', messageId: 'bg2', agent: 'int-agent', lane: 'background' });
        const claimed = q.claimNextPendingMessage('int-agent');
        q.markProcessing(claimed.id);
        expect(q.interruptMessage(claimed.id)).toBe(true);
        expect(q.getMessageStatus(claimed.id)).toBe('pending');
        expect(q.interruptMessage(claimed.id)).toBe(false);
        const again = q.claimNextPendingMessage('int-agent');
        expect(again.id).toBe(claimed.id);
        expect(again.retry_count).toBe(0);
    });
});
