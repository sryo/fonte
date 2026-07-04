import fs from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { Settings } from '@fonte/core';
import { SETTINGS_FILE, FONTE_HOME, getSettings, validateSettings, expandHomePath, ensureAgentDirectory, copyDirSync, SCRIPT_DIR, SOUL_PATH } from '@fonte/core';
import { log } from '@fonte/core';
import { ok, fail } from '../http';

/** Read, mutate, and persist settings.json atomically. */
export function mutateSettings(fn: (settings: Settings) => void): Settings {
    const settings = getSettings();
    fn(settings);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
    return settings;
}

const app = new Hono();

// GET /api/settings
app.get('/api/settings', (c) => {
    return ok(c, { settings: getSettings() });
});

// PUT /api/settings
app.put('/api/settings', async (c) => {
    const body = await c.req.json();
    const { typeErrors } = validateSettings(body);
    if (typeErrors.length) {
        return fail(c, typeErrors.join('; '));
    }
    const current = getSettings();
    const merged = { ...current, ...body } as Settings;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2) + '\n');
    log('INFO', '[API] Settings updated');
    return ok(c, { settings: merged });
});

// POST /api/setup — run initial setup (write settings + create directories)
app.post('/api/setup', async (c) => {
    const settings = (await c.req.json()) as Settings;

    if (settings.workspace?.path) {
        settings.workspace.path = expandHomePath(settings.workspace.path);
    }
    if (settings.agents) {
        for (const agent of Object.values(settings.agents)) {
            if (agent.working_directory) {
                agent.working_directory = expandHomePath(agent.working_directory) || agent.working_directory;
            }
        }
    }

    // Write settings.json
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
    log('INFO', '[API] Setup: settings.json written');

    // Create FONTE_HOME directories
    fs.mkdirSync(path.join(FONTE_HOME, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(FONTE_HOME, 'files'), { recursive: true });

    // Copy template files into FONTE_HOME
    const templateItems = ['.claude', 'heartbeat.md', 'AGENTS.md'];
    for (const item of templateItems) {
        const srcPath = path.join(SCRIPT_DIR, item);
        const destPath = path.join(FONTE_HOME, item);
        if (fs.existsSync(srcPath)) {
            if (fs.statSync(srcPath).isDirectory()) {
                copyDirSync(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    // Create workspace directory
    const workspacePath = settings.workspace?.path;
    if (workspacePath) {
        fs.mkdirSync(workspacePath, { recursive: true });
    }

    // Create agent directories
    if (settings.agents) {
        for (const agent of Object.values(settings.agents)) {
            ensureAgentDirectory(agent.working_directory);
        }
    }

    log('INFO', '[API] Setup complete');
    return ok(c, { settings });
});

// GET /api/soul — read soul personality file
app.get('/api/soul', (c) => {
    let content = '';
    try {
        if (fs.existsSync(SOUL_PATH)) {
            content = fs.readFileSync(SOUL_PATH, 'utf8');
        }
    } catch { /* ignore */ }
    return ok(c, { content, path: SOUL_PATH });
});

// PUT /api/soul — write soul personality file
app.put('/api/soul', async (c) => {
    try {
        const body = await c.req.json() as { content: string };
        fs.writeFileSync(SOUL_PATH, body.content, 'utf8');
        return ok(c);
    } catch (err) {
        return fail(c, (err as Error).message, 500);
    }
});

export default app;
