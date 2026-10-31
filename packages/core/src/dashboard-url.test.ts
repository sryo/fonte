import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let tmpHome: string;

beforeEach(() => {
    vi.resetModules();
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-dashboard-url-test-'));
    process.env.FONTE_HOME = tmpHome;
});

afterEach(() => {
    delete process.env.FONTE_HOME;
    vi.unstubAllEnvs();
    fs.rmSync(tmpHome, { recursive: true, force: true });
});

async function loadConfig(): Promise<typeof import('./config')> {
    return import('./config');
}

describe('dashboardUrl', () => {
    it('falls back to localhost:3000 when the front door never reported', async () => {
        const { dashboardUrl } = await loadConfig();
        expect(dashboardUrl()).toBe('http://localhost:3000');
    });

    it('is fonte.localhost once the front door is bound on 80', async () => {
        const { dashboardUrl, writeFrontDoorState } = await loadConfig();
        writeFrontDoorState({ bound: true, port: 80 });
        expect(dashboardUrl()).toBe('http://fonte.localhost');
    });

    it('keeps a non-default front door port in the URL', async () => {
        const { dashboardUrl, writeFrontDoorState } = await loadConfig();
        writeFrontDoorState({ bound: true, port: 8080 });
        expect(dashboardUrl()).toBe('http://fonte.localhost:8080');
    });

    it('falls back when the front door could not bind', async () => {
        const { dashboardUrl, writeFrontDoorState } = await loadConfig();
        writeFrontDoorState({ bound: false, port: 80, error: 'EACCES' });
        expect(dashboardUrl()).toBe('http://localhost:3000');
    });

    it('falls back on an unreadable state file', async () => {
        const { dashboardUrl, FRONT_DOOR_FILE } = await loadConfig();
        fs.writeFileSync(FRONT_DOOR_FILE, '{not json');
        expect(dashboardUrl()).toBe('http://localhost:3000');
    });

    it('lets FONTE_DASHBOARD_URL override everything', async () => {
        const { dashboardUrl, writeFrontDoorState } = await loadConfig();
        writeFrontDoorState({ bound: true, port: 80 });
        vi.stubEnv('FONTE_DASHBOARD_URL', 'http://studio.localhost:4000/');
        expect(dashboardUrl()).toBe('http://studio.localhost:4000');
    });

    it('reads back the last written state', async () => {
        const { readFrontDoorState, writeFrontDoorState } = await loadConfig();
        expect(readFrontDoorState()).toBeNull();
        writeFrontDoorState({ bound: false, port: 80, error: 'EADDRINUSE' });
        expect(readFrontDoorState()).toEqual({ bound: false, port: 80, error: 'EADDRINUSE' });
    });
});
