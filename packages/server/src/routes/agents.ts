import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Hono } from 'hono';
import { AgentConfig, CustomProvider } from '@fonte/core';
import { getSettings, getAgents, ensureAgentDirectory } from '@fonte/core';
import { log } from '@fonte/core';
import { mutateSettings } from './settings';
import { ok, fail } from '../http';

const app = new Hono();
const execFileAsync = promisify(execFile);

async function ensureSkillsCli(cwd: string) {
    try {
        await execFileAsync('npx', ['--yes', 'skills', '--version'], {
            cwd,
            env: { ...process.env, CI: '1' },
            timeout: 60_000,
            maxBuffer: 1024 * 1024,
        });
    } catch {
        // Best-effort: running any command will install the CLI if missing.
    }
}

async function runSkills(args: string[], cwd: string): Promise<string> {
    const { stdout, stderr } = await execFileAsync('npx', ['--yes', 'skills', ...args], {
        cwd,
        env: { ...process.env, CI: '1' },
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
    });
    return `${stdout}${stderr ? `\n${stderr}` : ''}`.trim();
}
app.get('/api/agents', (c) => {
    return ok(c, { agents: getAgents(getSettings()) });
});

app.put('/api/agents/:id', async (c) => {
    const agentId = c.req.param('id');
    const body = await c.req.json() as Partial<AgentConfig>;
    if (!body.name || !body.provider || !body.model) {
        return fail(c, 'name, provider, and model are required');
    }

    const currentSettings = getSettings();
    const isNew = !currentSettings.agents?.[agentId];

    const workspacePath = currentSettings.workspace?.path
        || path.join(require('os').homedir(), 'fonte-workspace');
    const workingDir = body.working_directory || path.join(workspacePath, agentId);

    const settings = mutateSettings(s => {
        if (!s.agents) s.agents = {};
        s.agents[agentId] = {
            name: body.name!,
            provider: body.provider!,
            model: body.model!,
            working_directory: workingDir,
            ...(body.prompt_file ? { prompt_file: body.prompt_file } : {}),
        };
    });

    if (isNew) {
        try {
            ensureAgentDirectory(workingDir);
            log('INFO', `[API] Agent '${agentId}' provisioned at ${workingDir}`);
        } catch (err) {
            log('ERROR', `[API] Agent '${agentId}' provisioning failed: ${(err as Error).message}`);
        }
    }

    if (body.system_prompt != null) {
        fs.writeFileSync(path.join(workingDir, 'AGENTS.md'), body.system_prompt, 'utf8');
    }

    log('INFO', `[API] Agent '${agentId}' saved`);
    return ok(c, {
        agent: settings.agents![agentId],
        provisioned: isNew,
    });
});

app.delete('/api/agents/:id', (c) => {
    const agentId = c.req.param('id');
    const settings = getSettings();
    if (!settings.agents?.[agentId]) {
        return fail(c, `agent '${agentId}' not found`, 404);
    }
    mutateSettings(s => { delete s.agents![agentId]; });
    log('INFO', `[API] Agent '${agentId}' deleted`);
    return ok(c);
});

// ── Agent workspace data endpoints ───────────────────────────────────────────

app.get('/api/agents/:id/skills', (c) => {
    const agentId = c.req.param('id');
    const settings = getSettings();
    const agent = settings.agents?.[agentId];
    if (!agent) return fail(c, `agent '${agentId}' not found`, 404);

    const skillsDir = path.join(agent.working_directory, '.agents', 'skills');
    const skills: { id: string; name: string; description: string }[] = [];

    if (fs.existsSync(skillsDir)) {
        for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
            let name = entry.name;
            let description = '';
            if (fs.existsSync(skillMd)) {
                try {
                    const content = fs.readFileSync(skillMd, 'utf8');
                    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
                    if (fmMatch) {
                        const fm = fmMatch[1];
                        const nameMatch = fm.match(/^name:\s*["']?(.+?)["']?\s*$/m);
                        if (nameMatch) name = nameMatch[1];
                        const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);
                        if (descMatch) description = descMatch[1];
                    }
                } catch { /* skip */ }
            }
            skills.push({ id: entry.name, name, description });
        }
    }

    return ok(c, { skills });
});

app.get('/api/agents/:id/skills/registry', async (c) => {
    const agentId = c.req.param('id');
    const query = c.req.query('query') || '';
    const settings = getSettings();
    const agent = settings.agents?.[agentId];
    if (!agent) return fail(c, `agent '${agentId}' not found`, 404);
    if (!query.trim()) return ok(c, { results: [] });

    try {
        await ensureSkillsCli(agent.working_directory);
        const output = await runSkills(['find', query], agent.working_directory);
        const cleaned = output
            .replace(/\u001b\[[0-9;]*m/g, '')
            .replace(/\x1b\[[0-9;]*m/g, '')
            .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
        const results: { ref: string; installs?: string; url?: string }[] = [];

        const refRegex = /([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+)/g;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let match: RegExpExecArray | null;
            while ((match = refRegex.exec(line)) !== null) {
                const ref = match[1];
                const installsMatch = line.match(/([\d.]+[KMB]?)\s+installs?/i);
                const installs = installsMatch ? installsMatch[1] : undefined;
                let url: string | undefined;

                const inlineUrl = line.match(/https?:\/\/\S+/);
                if (inlineUrl) {
                    url = inlineUrl[0];
                } else {
                    const next = lines[i + 1];
                    const cleanedNext = next?.replace(/^└\s*/, '');
                    if (cleanedNext && (cleanedNext.startsWith('http://') || cleanedNext.startsWith('https://'))) {
                        url = cleanedNext;
                    }
                }

                results.push({ ref, installs, url });
            }
        }

        return ok(c, { results, raw: output });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.post('/api/agents/:id/skills/install', async (c) => {
    const agentId = c.req.param('id');
    const settings = getSettings();
    const agent = settings.agents?.[agentId];
    if (!agent) return fail(c, `agent '${agentId}' not found`, 404);

    const body = await c.req.json() as { ref?: string };
    const ref = (body.ref || '').trim();
    if (!ref) return fail(c, 'ref is required');

    try {
        await ensureSkillsCli(agent.working_directory);
        const output = await runSkills(['add', ref, '-a', 'codex', '-y'], agent.working_directory);
        return ok(c, { output });
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

app.get('/api/agents/:id/system-prompt', (c) => {
    const agentId = c.req.param('id');
    const settings = getSettings();
    const agent = settings.agents?.[agentId];
    if (!agent) return fail(c, `agent '${agentId}' not found`, 404);

    const agentsMd = path.join(agent.working_directory, 'AGENTS.md');
    let content = '';
    if (fs.existsSync(agentsMd)) {
        try { content = fs.readFileSync(agentsMd, 'utf8'); } catch { /* skip */ }
    }
    return ok(c, { content, path: agentsMd });
});

app.put('/api/agents/:id/system-prompt', async (c) => {
    const agentId = c.req.param('id');
    const settings = getSettings();
    const agent = settings.agents?.[agentId];
    if (!agent) return fail(c, `agent '${agentId}' not found`, 404);

    const body = await c.req.json() as { content: string };
    const agentsMd = path.join(agent.working_directory, 'AGENTS.md');
    fs.writeFileSync(agentsMd, body.content || '', 'utf8');
    return ok(c);
});

app.get('/api/agents/:id/memory', (c) => {
    const agentId = c.req.param('id');
    const settings = getSettings();
    const agent = settings.agents?.[agentId];
    if (!agent) return fail(c, `agent '${agentId}' not found`, 404);

    const { loadMemoryIndex } = require('@fonte/core');
    const index = loadMemoryIndex(agent.working_directory);
    const memoryDir = path.join(agent.working_directory, 'memory');
    const files: { name: string; path: string }[] = [];

    if (fs.existsSync(memoryDir)) {
        const scan = (dir: string, rel: string) => {
            for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
                if (item.name.startsWith('.')) continue;
                const itemRel = rel ? `${rel}/${item.name}` : item.name;
                if (item.isDirectory()) {
                    scan(path.join(dir, item.name), itemRel);
                } else if (item.name.endsWith('.md')) {
                    files.push({ name: item.name, path: itemRel });
                }
            }
        };
        scan(memoryDir, '');
    }

    return ok(c, { index, files, memoryDir });
});

app.get('/api/agents/:id/heartbeat', (c) => {
    const agentId = c.req.param('id');
    const settings = getSettings();
    const agent = settings.agents?.[agentId];
    if (!agent) return fail(c, `agent '${agentId}' not found`, 404);

    const heartbeatMd = path.join(agent.working_directory, 'heartbeat.md');
    let content = '';
    if (fs.existsSync(heartbeatMd)) {
        try { content = fs.readFileSync(heartbeatMd, 'utf8'); } catch { /* skip */ }
    }
    return ok(c, {
        content,
        path: heartbeatMd,
        enabled: agent.heartbeat?.enabled ?? true,
        interval: agent.heartbeat?.interval,
    });
});

app.put('/api/agents/:id/heartbeat', async (c) => {
    const agentId = c.req.param('id');
    const settings = getSettings();
    const agent = settings.agents?.[agentId];
    if (!agent) return fail(c, `agent '${agentId}' not found`, 404);

    const body = await c.req.json() as { content?: string; enabled?: boolean; interval?: number };

    if (body.content != null) {
        const heartbeatMd = path.join(agent.working_directory, 'heartbeat.md');
        fs.writeFileSync(heartbeatMd, body.content || '', 'utf8');
    }

    if (body.enabled != null || body.interval != null) {
        mutateSettings(s => {
            if (!s.agents?.[agentId]) return;
            if (!s.agents[agentId].heartbeat) s.agents[agentId].heartbeat = {};
            if (body.enabled != null) s.agents[agentId].heartbeat!.enabled = body.enabled;
            if (body.interval != null) s.agents[agentId].heartbeat!.interval = body.interval;
        });
    }

    return ok(c);
});

// ── Custom Providers ─────────────────────────────────────────────────────────

app.get('/api/custom-providers', (c) => {
    const settings = getSettings();
    return ok(c, { providers: settings.custom_providers || {} });
});

app.put('/api/custom-providers/:id', async (c) => {
    const providerId = c.req.param('id');
    const body = await c.req.json() as Partial<CustomProvider>;
    if (!body.name || !body.harness || !body.base_url || !body.api_key) {
        return fail(c, 'name, harness, base_url, and api_key are required');
    }
    if (body.harness !== 'claude' && body.harness !== 'codex') {
        return fail(c, 'harness must be "claude" or "codex"');
    }

    const settings = mutateSettings(s => {
        if (!s.custom_providers) s.custom_providers = {};
        s.custom_providers[providerId] = {
            name: body.name!,
            harness: body.harness!,
            base_url: body.base_url!,
            api_key: body.api_key!,
            ...(body.model ? { model: body.model } : {}),
        };
    });

    log('INFO', `[API] Custom provider '${providerId}' saved`);
    return ok(c, { provider: settings.custom_providers![providerId] });
});

app.delete('/api/custom-providers/:id', (c) => {
    const providerId = c.req.param('id');
    const settings = getSettings();
    if (!settings.custom_providers?.[providerId]) {
        return fail(c, `custom provider '${providerId}' not found`, 404);
    }
    mutateSettings(s => { delete s.custom_providers![providerId]; });
    log('INFO', `[API] Custom provider '${providerId}' deleted`);
    return ok(c);
});

export default app;
