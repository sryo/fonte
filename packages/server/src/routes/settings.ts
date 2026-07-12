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

// Expand ~/$HOME in every path-valued leaf, so a value entered on any
// screen lands on disk the same way the setup wizard would store it.
function expandSettingsPaths(settings: Settings): void {
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
}

const app = new Hono();

app.get('/api/settings', (c) => {
    return ok(c, { settings: getSettings() });
});

app.put('/api/settings', async (c) => {
    const body = await c.req.json();
    const { typeErrors } = validateSettings(body);
    if (typeErrors.length) {
        return fail(c, typeErrors.join('; '));
    }
    const current = getSettings();
    const merged = { ...current, ...body } as Settings;
    expandSettingsPaths(merged);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2) + '\n');
    log('INFO', '[API] Settings updated');
    return ok(c, { settings: merged });
});

app.post('/api/setup', async (c) => {
    const settings = (await c.req.json()) as Settings;

    expandSettingsPaths(settings);

    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
    log('INFO', '[API] Setup: settings.json written');

    fs.mkdirSync(path.join(FONTE_HOME, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(FONTE_HOME, 'files'), { recursive: true });

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

    const workspacePath = settings.workspace?.path;
    if (workspacePath) {
        fs.mkdirSync(workspacePath, { recursive: true });
    }

    if (settings.agents) {
        for (const agent of Object.values(settings.agents)) {
            ensureAgentDirectory(agent.working_directory);
        }
    }

    log('INFO', '[API] Setup complete');
    return ok(c, { settings });
});

app.get('/api/soul', (c) => {
    let content = '';
    try {
        if (fs.existsSync(SOUL_PATH)) {
            content = fs.readFileSync(SOUL_PATH, 'utf8');
        }
    } catch { /* ignore */ }
    return ok(c, { content, path: SOUL_PATH });
});

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
