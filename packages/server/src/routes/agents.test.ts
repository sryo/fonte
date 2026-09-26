import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

let tmpHome: string;
let workspace: string;
let app: (typeof import('./agents'))['default'];

beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-agents-route-test-'));
    workspace = path.join(tmpHome, 'workspace');
    fs.mkdirSync(path.join(tmpHome, 'logs'), { recursive: true });
    process.env.FONTE_HOME = tmpHome;
    app = (await import('./agents')).default;
});

afterAll(() => {
    delete process.env.FONTE_HOME;
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

function settingsPath(): string {
    return path.join(tmpHome, 'settings.json');
}

function writeSettings(settings: Record<string, unknown>): void {
    fs.writeFileSync(settingsPath(), JSON.stringify({ workspace: { path: workspace }, ...settings }));
}

function readSettings(): Record<string, any> {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
}

beforeEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    writeSettings({});
});

function putAgent(id: string, body: unknown): Promise<Response> {
    return app.request(`/api/agents/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const agentBody = { name: 'Helper', provider: 'anthropic', model: 'sonnet' };

describe('PUT /api/agents/:id', () => {
    it.each(['../x', 'My Agent', 'UPPER', 'a/b', '.hidden', ''])('rejects the id %j with 400', async (id) => {
        const res = await putAgent(id || ' ', agentBody);
        expect(res.status).toBe(400);
        expect(readSettings().agents).toBeUndefined();
        expect(fs.existsSync(path.join(tmpHome, 'x'))).toBe(false);
    });

    it('accepts ids the CLI would produce', async () => {
        const res = await putAgent('my-agent_2', agentBody);
        expect(res.status).toBe(200);
        expect(readSettings().agents['my-agent_2'].working_directory).toBe(path.join(workspace, 'my-agent_2'));
    });

    it('keeps prompt_file and heartbeat when saving over an existing agent', async () => {
        writeSettings({
            agents: {
                helper: {
                    name: 'Helper',
                    provider: 'anthropic',
                    model: 'sonnet',
                    working_directory: path.join(workspace, 'helper'),
                    prompt_file: 'PROMPT.md',
                    heartbeat: { enabled: false, interval: 600 },
                },
            },
        });

        const res = await putAgent('helper', { name: 'Helper 2', provider: 'openai', model: 'gpt-5.3-codex' });
        expect(res.status).toBe(200);
        expect(readSettings().agents.helper).toEqual({
            name: 'Helper 2',
            provider: 'openai',
            model: 'gpt-5.3-codex',
            working_directory: path.join(workspace, 'helper'),
            prompt_file: 'PROMPT.md',
            heartbeat: { enabled: false, interval: 600 },
        });
    });

    it('keeps the existing working directory when the body omits it', async () => {
        const custom = path.join(tmpHome, 'elsewhere');
        writeSettings({
            agents: { helper: { ...agentBody, working_directory: custom } },
        });

        await putAgent('helper', agentBody);
        expect(readSettings().agents.helper.working_directory).toBe(custom);
    });
});

describe('DELETE /api/custom-providers/:id', () => {
    const provider = { name: 'Local', harness: 'claude', base_url: 'http://localhost:1234', api_key: 'k' };

    it('refuses with 409 and names the agents that still use the provider', async () => {
        writeSettings({
            custom_providers: { local: provider },
            agents: {
                a: { ...agentBody, provider: 'custom:local', working_directory: '/tmp/a' },
                b: { ...agentBody, working_directory: '/tmp/b' },
                c: { ...agentBody, provider: 'custom:local', working_directory: '/tmp/c' },
            },
        });

        const res = await app.request('/api/custom-providers/local', { method: 'DELETE' });
        expect(res.status).toBe(409);
        const json = await res.json() as { ok: boolean; error: string; agents: string[] };
        expect(json.ok).toBe(false);
        expect(json.agents).toEqual(['a', 'c']);
        expect(json.error).toContain('a, c');
        expect(readSettings().custom_providers.local).toBeDefined();
    });

    it('deletes a provider no agent uses', async () => {
        writeSettings({
            custom_providers: { local: provider },
            agents: { b: { ...agentBody, working_directory: '/tmp/b' } },
        });

        const res = await app.request('/api/custom-providers/local', { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(readSettings().custom_providers.local).toBeUndefined();
    });
});
