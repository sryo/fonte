import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let tmpHome: string;
let core: typeof import('@fonte/core');
let app: ReturnType<(typeof import('./queue'))['createQueueRoutes']>;

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-queue-route-test-'));
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true });
    process.env.FONTE_HOME = tmpHome;
    core = await import('@fonte/core');
    core.initQueueDb();
    app = (await import('./queue')).createQueueRoutes();
});

afterAll(() => {
    core.closeQueueDb();
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

function send(messageId: string, text: string): number {
    const id = core.enqueueMessage({ messageId, channel: 'web', sender: 'Web', message: text, agent: 'a' })!;
    core.insertAgentMessage({ agentId: 'a', role: 'user', channel: 'web', sender: 'Web', messageId, content: text });
    return id;
}

const transcript = () => core.getAgentMessages('a').map((m: { content: string }) => m.content);

const cancel = (id: number) => app.request(`/api/queue/processing/${id}/cancel`, { method: 'POST' });

describe('POST /api/queue/processing/:id/cancel', () => {
    it('takes a message that never started out of the transcript', async () => {
        const id = send('m-waiting', 'never started');
        expect(transcript()).toContain('never started');

        expect((await cancel(id)).status).toBe(200);
        expect(transcript()).not.toContain('never started');
    });

    it('keeps the message of a run that already started', async () => {
        const id = send('m-running', 'already running');
        const db = new Database(path.join(tmpHome, 'fonte.db'));
        db.prepare(`UPDATE messages SET status='processing' WHERE id=?`).run(id);
        db.close();

        expect((await cancel(id)).status).toBe(200);
        expect(transcript()).toContain('already running');
    });
});
