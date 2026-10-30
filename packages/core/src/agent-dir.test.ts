import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureAgentDirectory } from './agent';

describe('ensureAgentDirectory', () => {
    let root: string;
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('gives a new agent only the skills link in .claude, never the checkout\'s own .claude', () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-agent-dir-'));
        const agentDir = path.join(root, 'agent');
        ensureAgentDirectory(agentDir);
        const claudeDir = path.join(agentDir, '.claude');
        const entries = fs.existsSync(claudeDir) ? fs.readdirSync(claudeDir) : [];
        expect(entries.filter((e) => e !== 'skills')).toEqual([]);
    });
});
