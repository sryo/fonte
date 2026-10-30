import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentConfig, TeamConfig } from './types';

const PROMPT_FILE = path.resolve(__dirname, '../prompts/agent.md');
const DEV_GUIDE_FILE = path.resolve(__dirname, '../../../AGENTS.md');

const SYSTEM_PROMPT_BUDGET_BYTES = 15104;

type AgentModule = typeof import('./agent');

describe('runtime agent prompt', () => {
    let home: string;
    let agentDir: string;
    let agentModule: AgentModule;

    const agents: Record<string, AgentConfig> = {
        fonte: { name: 'Fonte', provider: 'anthropic', model: 'sonnet', working_directory: '' },
        helper: { name: 'Helper', provider: 'anthropic', model: 'opus', working_directory: '' },
    };
    const teams: Record<string, TeamConfig> = {
        crew: { name: 'Crew', agents: ['fonte', 'helper'], leader_agent: 'fonte' },
    };

    beforeAll(async () => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'fonte-agent-prompt-'));
        fs.mkdirSync(path.join(home, 'logs'));
        agentDir = path.join(home, 'workspace', 'fonte');
        fs.mkdirSync(agentDir, { recursive: true });
        agents.fonte.working_directory = agentDir;
        agents.helper.working_directory = path.join(home, 'workspace', 'helper');
        vi.stubEnv('FONTE_HOME', home);
        vi.stubEnv('FONTE_API_PORT', '3777');
        vi.resetModules();
        agentModule = await import('./agent');
    });

    afterAll(() => {
        vi.unstubAllEnvs();
        fs.rmSync(home, { recursive: true, force: true });
    });

    it('loads the built-in instructions from packages/core/prompts/agent.md', () => {
        const fromFile = fs.readFileSync(PROMPT_FILE, 'utf8');
        expect(agentModule.BUILTIN_AGENT_INSTRUCTIONS).toBe(fromFile);
        expect(fromFile.trim().length).toBeGreaterThan(0);
        expect(fromFile).toContain('## Rules');
        expect(fromFile).toContain('<!-- TEAMMATES_START -->');
        expect(fromFile).toContain('<!-- MEMORY_START -->');
    });

    it('keeps the developer guide out of the system prompt', () => {
        const prompt = agentModule.buildSystemPrompt('fonte', agentDir, agents, teams);
        expect(prompt).toContain('## Rules');
        expect(prompt).toContain('`@helper`');
        const devGuide = fs.readFileSync(DEV_GUIDE_FILE, 'utf8');
        const devOnlyHeading = devGuide.split('\n').find(line => line.startsWith('# '));
        expect(devOnlyHeading).toBeDefined();
        expect(prompt).not.toContain(devOnlyHeading!);
        expect(prompt).not.toContain('npm run check');
        expect(prompt).not.toContain('launchd');
    });

    it('stays within the system prompt size budget', () => {
        const prompt = agentModule.buildSystemPrompt('fonte', agentDir, agents, teams);
        const bytes = Buffer.byteLength(prompt, 'utf8');
        expect(
            bytes,
            `The built system prompt grew to ${bytes} bytes, over the ${SYSTEM_PROMPT_BUDGET_BYTES}-byte budget. ` +
            'Every byte is sent on every agent turn. Trim the prompt, or raise SYSTEM_PROMPT_BUDGET_BYTES deliberately in this test.',
        ).toBeLessThanOrEqual(SYSTEM_PROMPT_BUDGET_BYTES);
    });
});
