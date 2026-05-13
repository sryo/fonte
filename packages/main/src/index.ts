#!/usr/bin/env node
/**
 * AITorrent Queue Processor — Entry point.
 *
 * Initializes the SQLite queue, starts the API server, processes messages,
 * and manages lifecycle. This is the only file that should be run directly.
 */

import fs from 'fs';
import path from 'path';
import {
    MessageJobData,
    getSettings, getAgents, LOG_FILE, FILES_DIR, AITORRENT_HOME,
    log, emitEvent, onEvent,
    parseAgentRouting, getAgentResetFlag,
    invokeAgent, killAgentProcess,
    loadPlugins, runIncomingHooks,
    streamResponse,
    initQueueDb, getPendingAgents, claimAllPendingMessages,
    markProcessing, completeMessage, failMessage,
    recoverStaleMessages, pruneAckedResponses, pruneCompletedMessages,
    closeQueueDb, queueEvents,
    insertAgentMessage,
    startScheduler, stopScheduler,
} from '@aitorrent/core';
import { startApiServer } from '@aitorrent/server';
import { createTorrentManager, startWatchlistRunner, stopWatchlistRunner, handleTorrentCompleted, createAutomationEngine } from '@aitorrent/torrent';

// Ensure directories exist
[FILES_DIR, path.dirname(LOG_FILE)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// ── Message Processing ──────────────────────────────────────────────────────

async function processMessage(dbMsg: any): Promise<void> {
    const data: MessageJobData = {
        channel: dbMsg.channel,
        sender: dbMsg.sender,
        senderId: dbMsg.sender_id,
        message: dbMsg.message,
        messageId: dbMsg.message_id,
        agent: dbMsg.agent ?? undefined,
        fromAgent: dbMsg.from_agent ?? undefined,
    };

    const { channel, sender, message: rawMessage, messageId, agent: preRoutedAgent } = data;
    const isInternal = !!data.fromAgent;

    log('INFO', `Processing [${isInternal ? 'internal' : channel}] ${isInternal ? `@${data.fromAgent}→@${preRoutedAgent}` : `from ${sender}`}: ${rawMessage}`);

    const settings = getSettings();
    const agents = getAgents(settings);
    const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'aitorrent-workspace');

    // ── Route message to agent ──────────────────────────────────────────────
    let agentId: string;
    let message: string;

    if (preRoutedAgent && agents[preRoutedAgent]) {
        agentId = preRoutedAgent;
        message = rawMessage;
    } else {
        const routing = parseAgentRouting(rawMessage, agents);
        agentId = routing.agentId;
        message = routing.message;
    }

    if (!agents[agentId]) {
        agentId = 'aitorrent';
        message = rawMessage;
    }
    if (!agents[agentId]) {
        agentId = Object.keys(agents)[0];
    }

    const agent = agents[agentId];

    // ── Invoke agent ────────────────────────────────────────────────────────
    const agentResetFlag = getAgentResetFlag(agentId, workspacePath);
    const shouldReset = fs.existsSync(agentResetFlag);
    if (shouldReset) {
        fs.unlinkSync(agentResetFlag);
    }

    ({ text: message } = await runIncomingHooks(message, { channel, sender, messageId, originalMessage: rawMessage }));

    emitEvent('agent:invoke', { agentId, agentName: agent.name, fromAgent: data.fromAgent || null });
    let response: string;
    try {
        response = await invokeAgent(agent, agentId, message, workspacePath, shouldReset, agents, {}, (text) => {
            log('INFO', `Agent ${agentId}: ${text}`);
            insertAgentMessage({ agentId, role: 'assistant', channel, sender: agentId, messageId, content: text });
            emitEvent('agent:progress', { agentId, agentName: agent.name, text, messageId });
            sendDirectResponse(text, {
                channel, sender, senderId: data.senderId,
                messageId, originalMessage: rawMessage, agentId,
            });
        });
    } catch (error) {
        const provider = agent.provider || 'anthropic';
        const providerLabel = provider === 'openai' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : 'Claude';
        log('ERROR', `${providerLabel} error (agent: ${agentId}): ${(error as Error).message}`);
        response = "Sorry, I encountered an error processing your request. Please check the queue logs.";
        const msgSender = isInternal ? data.fromAgent! : sender;
        insertAgentMessage({ agentId, role: 'assistant', channel, sender: msgSender, messageId, content: response });
        await sendDirectResponse(response, {
            channel, sender, senderId: data.senderId,
            messageId, originalMessage: rawMessage, agentId,
        });
    }

    emitEvent('agent:response', {
        agentId, agentName: agent.name, role: 'assistant',
        channel, sender, messageId,
        content: response,
    });

    // ── Response routing ────────────────────────────────────────────────────
    await sendDirectResponse(response, {
        channel: data.channel, sender: data.sender, senderId: data.senderId,
        messageId, originalMessage: rawMessage, agentId,
    });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function sendDirectResponse(
    response: string,
    ctx: { channel: string; sender: string; senderId?: string | null; messageId: string; originalMessage: string; agentId: string }
): Promise<void> {
    const signed = `${response}\n\n- [${ctx.agentId}]`;
    await streamResponse(signed, {
        channel: ctx.channel,
        sender: ctx.sender,
        senderId: ctx.senderId ?? undefined,
        messageId: ctx.messageId,
        originalMessage: ctx.originalMessage,
        agentId: ctx.agentId,
    });
}

// ── Queue Processing ────────────────────────────────────────────────────────

const agentChains = new Map<string, Promise<void>>();

async function processQueue(): Promise<void> {
    const pendingAgents = getPendingAgents();
    if (pendingAgents.length === 0) return;

    for (const agentId of pendingAgents) {
        const messages = claimAllPendingMessages(agentId);
        if (messages.length === 0) continue;

        const currentChain = agentChains.get(agentId) || Promise.resolve();
        // .catch() prevents a rejected chain from blocking subsequent messages
        const newChain = currentChain.catch(() => {}).then(async () => {
            for (const msg of messages) {
                try {
                    markProcessing(msg.id);
                    await processMessage(msg);
                    completeMessage(msg.id);
                } catch (error) {
                    log('ERROR', `Failed to process message ${msg.id}: ${(error as Error).message}`);
                    failMessage(msg.id, (error as Error).message);
                }
            }
        });
        agentChains.set(agentId, newChain);
        newChain.finally(() => {
            if (agentChains.get(agentId) === newChain) {
                agentChains.delete(agentId);
            }
        });
    }
}

function logAgentConfig(): void {
    const settings = getSettings();
    const agents = getAgents(settings);

    const agentCount = Object.keys(agents).length;
    log('INFO', `Loaded ${agentCount} agent(s):`);
    for (const [id, agent] of Object.entries(agents)) {
        log('INFO', `  ${id}: ${agent.name} [${agent.provider}/${agent.model}] cwd=${agent.working_directory}`);
    }
}

// ─── Start ──────────────────────────────────────────────────────────────────

initQueueDb();

// Write PID file so the CLI can find this process
fs.writeFileSync(path.join(AITORRENT_HOME, 'aitorrent.pid'), String(process.pid));

// Recover any messages left in 'processing' from a previous run — they're
// guaranteed stale because the process just restarted.
const startupRecovered = recoverStaleMessages(0);
if (startupRecovered > 0) {
    log('INFO', `Startup: recovered ${startupRecovered} in-flight message(s) from previous run`);
}

const apiServer = startApiServer({
    restart() {
        log('INFO', 'Restart requested via API');
        shutdown(75);
    },
});

// Event-driven: process queue when a new message arrives
queueEvents.on('message:enqueued', () => processQueue());

// When user manually kills an agent session, clear its promise chain
queueEvents.on('agent:killed', ({ agentId }: { agentId: string }) => {
    agentChains.delete(agentId);
    log('INFO', `Cleared agent chain for ${agentId}`);
});

// Also poll periodically in case events are missed
const pollInterval = setInterval(() => processQueue(), 5000);

// Periodic maintenance (prune old completed/acked records)
const maintenanceInterval = setInterval(() => {
    pruneAckedResponses();
    pruneCompletedMessages();
}, 60 * 1000);

// Load plugins
(async () => {
    await loadPlugins();
})();

// Start in-process cron scheduler
startScheduler();

// Start torrent manager
const torrentManager = createTorrentManager(getSettings().torrent);
torrentManager.start().catch(err => {
    log('ERROR', `Failed to start TorrentManager: ${err.message}`);
});

// Start watchlist runner (if enabled)
const watchlistSettings = getSettings().watchlist;
if (watchlistSettings?.enabled) {
    const intervalMinutes = watchlistSettings.check_interval_minutes || 30;
    startWatchlistRunner(intervalMinutes);
}

// Start automation engine
const automationEngine = createAutomationEngine();
automationEngine.start();

// Auto-fetch subtitles when a torrent completes
onEvent((type, data) => {
    if (type === 'torrent:completed' && data.id) {
        handleTorrentCompleted(data.id as string).catch(err => {
            log('ERROR', `Subtitle auto-fetch failed for ${data.id}: ${(err as Error).message}`);
        });
    }
});

log('INFO', 'Queue processor started (SQLite)');
logAgentConfig();
log('INFO', `Agents: ${Object.keys(getAgents(getSettings())).join(', ')}`);

// Graceful shutdown. Exit code 75 signals "restart" to the Docker entrypoint loop.
function shutdown(exitCode = 0): void {
    log('INFO', exitCode === 75 ? 'Restarting queue processor...' : 'Shutting down queue processor...');
    stopScheduler();
    stopWatchlistRunner();
    automationEngine.stop();
    torrentManager.stop().catch(() => {});
    clearInterval(pollInterval);
    clearInterval(maintenanceInterval);
    apiServer.close();
    closeQueueDb();
    // Clean up PID file on normal shutdown (not restart)
    if (exitCode !== 75) {
        try { fs.unlinkSync(path.join(AITORRENT_HOME, 'aitorrent.pid')); } catch {}
    }
    process.exit(exitCode);
}

process.on('SIGINT', () => { shutdown(); });
process.on('SIGTERM', () => { shutdown(); });
