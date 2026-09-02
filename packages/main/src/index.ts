#!/usr/bin/env node
// Fonte daemon entry point: SQLite queue processor, API server, and lifecycle.

import fs from 'fs';
import path from 'path';
import {
    MessageJobData,
    getSettings, getAgents, checkSettingsFile, LOG_FILE, FILES_DIR, FONTE_HOME,
    log, emitEvent, onEvent, notifyForEvent,
    parseAgentRouting, getAgentResetFlag,
    invokeAgent, killAgentProcess, getActiveAgentIds,
    loadPlugins, runIncomingHooks,
    streamResponse,
    initQueueDb, getPendingAgents, claimNextPendingMessage,
    markProcessing, completeMessage, failMessage, getMessageStatus, setMessageSessionId,
    interruptMessage, oldestPendingUserMessageAge, getProcessingMessages,
    recoverStaleMessages, pruneAckedResponses, pruneCompletedMessages,
    closeQueueDb, queueEvents,
    insertAgentMessage, deleteAgentMessagesByMessageId, updateAgentToolMessage,
    registerSystemPromptSection,
} from '@fonte/core';
import { startApiServer } from '@fonte/server';
import {
    createTorrentManager, startWatchlistRunner, stopWatchlistRunner, handleTorrentCompleted,
    createAutomationEngine, getWhatsAppService, backfillPosters,
    AUTOMATION_QUIET_REPLY, renderAutomationsSection,
} from '@fonte/torrent';

// A background run older than this while a person is waiting gets paused and re-queued.
const USER_WAIT_WATCHDOG_MS = 45_000;
const TOOL_ROW_MAX_CHARS = 20_000;
const RECOVERY_PREAMBLE = '[recovery] Your previous attempt at this message was interrupted by a restart. Part of it may already be done. Check before claiming anything is complete, and if you cannot tell what was asked, say so instead of guessing.\n\n';

[FILES_DIR, path.dirname(LOG_FILE)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// A torrent daemon running on silently-defaulted paths is worse than one that
// refuses to start: a present-but-unusable settings.json is fatal.
const settingsHealth = checkSettingsFile();
if (!settingsHealth.ok) {
    log('ERROR', `Refusing to start: ${settingsHealth.reason}`);
    console.error(`[ERROR] Refusing to start: ${settingsHealth.reason}`);
    process.exit(1);
}

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
    const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'fonte-workspace');

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
        agentId = 'fonte';
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
    if ((dbMsg.recovery ?? 0) > 0) message = RECOVERY_PREAMBLE + message;

    emitEvent('agent:invoke', { agentId, agentName: agent.name, fromAgent: data.fromAgent || null });
    let sessionId: string | null = null;
    let response: string;
    let errored = false;
    let runError: Error | null = null;
    try {
        response = await invokeAgent(agent, agentId, message, workspacePath, shouldReset, agents, {}, {
            onEvent: (text) => {
                log('INFO', `Agent ${agentId}: ${text}`);
                insertAgentMessage({ agentId, role: 'assistant', channel, sender: agentId, messageId, content: text });
                emitEvent('agent:progress', { agentId, agentName: agent.name, text, messageId });
                // Don't send intermediate chunks to the channel: some adapters emit the
                // full response as one chunk, which would duplicate the final send below.
            },
            resumeSessionId: dbMsg.resume_session_id ?? undefined,
            onSessionId: (id) => { sessionId = id; },
            onTool: (name, input, toolUseId) => {
                let content = JSON.stringify({ name, input, toolUseId });
                if (content.length > TOOL_ROW_MAX_CHARS) {
                    const room = TOOL_ROW_MAX_CHARS - JSON.stringify({ name, toolUseId, input: '' }).length;
                    content = JSON.stringify({ name, toolUseId, input: JSON.stringify(input).slice(0, Math.max(0, room)) });
                }
                insertAgentMessage({ agentId, role: 'assistant', channel, sender: agentId, messageId, content, kind: 'tool' });
                emitEvent('agent:progress', { agentId, agentName: agent.name, tool: name, messageId });
            },
            onToolResult: (toolUseId, isError) => {
                updateAgentToolMessage(agentId, messageId, toolUseId, { status: isError ? 'failed' : 'done' });
                emitEvent('agent:progress', { agentId, agentName: agent.name, toolResult: toolUseId, failed: isError, messageId });
            },
        });
    } catch (error) {
        errored = true;
        runError = error as Error;
        const provider = agent.provider || 'anthropic';
        const providerLabel = provider === 'openai' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : 'Claude';
        log('ERROR', `${providerLabel} error (agent: ${agentId}): ${(error as Error).message}`);
        response = "Sorry, I encountered an error processing your request. Please check the queue logs.";
    }

    // Session persists even for stopped runs, so an edit can fork from them.
    if (sessionId) setMessageSessionId(dbMsg.id, sessionId);
    const statusAfterRun = getMessageStatus(dbMsg.id);
    // A stopped run must never deliver its partial answer to any channel.
    if (statusAfterRun === 'cancelled') {
        insertAgentMessage({ agentId, role: 'assistant', channel, sender: agentId, messageId, content: 'Stopped', kind: 'system' });
        return;
    }
    // The watchdog put the row back to pending; it re-runs after the user's turn.
    if (statusAfterRun === 'pending') {
        deleteAgentMessagesByMessageId(agentId, messageId, 'assistant');
        return;
    }
    if (errored) {
        emitEvent('agent:error', { agentId, agentName: agent.name, messageId, channel, error: runError?.message ?? 'Agent run failed' });
    }
    if (errored) {
        const msgSender = isInternal ? data.fromAgent! : sender;
        insertAgentMessage({ agentId, role: 'assistant', channel, sender: msgSender, messageId, content: response });
        await sendDirectResponse(response, {
            channel, sender, senderId: data.senderId,
            messageId, originalMessage: rawMessage, agentId,
        });
        return;
    }

    if (response.trim() === AUTOMATION_QUIET_REPLY) {
        deleteAgentMessagesByMessageId(agentId, messageId, 'assistant');
        insertAgentMessage({ agentId, role: 'assistant', channel, sender: agentId, messageId, content: 'Nothing to report', kind: 'system' });
        emitEvent('agent:response', {
            agentId, agentName: agent.name, role: 'assistant',
            channel, sender, messageId,
            content: '', quiet: true,
        });
        return;
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
// Bumped when the user kills an agent session; running batches compare their
// starting epoch and drop remaining messages instead of carrying on.
const agentKillEpoch = new Map<string, number>();

async function processQueue(): Promise<void> {
    const pendingAgents = getPendingAgents();
    if (pendingAgents.length === 0) return;

    for (const agentId of pendingAgents) {
        if (agentChains.has(agentId)) continue;

        // One claim per turn, user lane first, so a message that arrives while a
        // batch of background wakes is queued still runs before them.
        const newChain = (async () => {
            const epoch = agentKillEpoch.get(agentId) || 0;
            for (;;) {
                const msg = claimNextPendingMessage(agentId);
                if (!msg) break;
                if (getMessageStatus(msg.id) === 'cancelled') continue;
                if ((agentKillEpoch.get(agentId) || 0) !== epoch) {
                    failMessage(msg.id, 'Agent killed');
                    continue;
                }
                try {
                    markProcessing(msg.id);
                    await processMessage(msg);
                    completeMessage(msg.id);
                } catch (error) {
                    log('ERROR', `Failed to process message ${msg.id}: ${(error as Error).message}`);
                    const outcome = failMessage(msg.id, (error as Error).message);
                    // A retry reports its own outcome; only a dead row needs closing here.
                    if (outcome === 'dead') {
                        emitEvent('agent:error', { agentId, messageId: msg.message_id, error: (error as Error).message });
                    }
                }
            }
        })();
        agentChains.set(agentId, newChain);
        newChain.catch(() => {}).finally(() => {
            if (agentChains.get(agentId) === newChain) {
                agentChains.delete(agentId);
            }
            // A message enqueued while the loop was winding down starts a fresh chain.
            void processQueue();
        });
    }
}

/**
 * A person waiting behind a background run gets priority: the run is paused,
 * its row goes back to pending (it re-runs after the user's turn), and the
 * chat gets a note explaining the pause.
 */
function pauseBackgroundRunsForWaitingUsers(): void {
    for (const row of getProcessingMessages()) {
        if (row.status !== 'processing' || row.lane !== 'background') continue;
        const agentId: string = row.agent || 'default';
        const waited = oldestPendingUserMessageAge(agentId);
        if (waited === null || waited < USER_WAIT_WATCHDOG_MS) continue;
        if (!interruptMessage(row.id)) continue;
        killAgentProcess(agentId);
        emitEvent('agent:interrupted', { agentId, messageId: row.message_id, reason: 'Paused for your message' });
        insertAgentMessage({
            agentId, role: 'user', channel: row.channel, sender: 'Fonte', messageId: `${row.message_id}_paused`, kind: 'event',
            content: JSON.stringify({ event: 'automation-paused', summary: 'Paused an automation to answer you' }),
        });
        log('INFO', `Paused background run ${row.message_id} for ${agentId}: a user message waited ${Math.round(waited / 1000)}s`);
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
fs.writeFileSync(path.join(FONTE_HOME, 'fonte.pid'), String(process.pid));

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

queueEvents.on('message:enqueued', () => processQueue());

// When user manually kills an agent session, abort the running batch.
// Deleting the chain here would let a new batch start while the old loop
// still holds claimed messages — two concurrent processors for one agent.
queueEvents.on('agent:killed', ({ agentId }: { agentId: string }) => {
    agentKillEpoch.set(agentId, (agentKillEpoch.get(agentId) || 0) + 1);
    log('INFO', `Aborting message batch for killed agent ${agentId}`);
});

// Also poll periodically in case events are missed
const pollInterval = setInterval(() => processQueue(), 5000);

const maintenanceInterval = setInterval(() => {
    pruneAckedResponses();
    pruneCompletedMessages();
}, 60 * 1000);

const watchdogInterval = setInterval(pauseBackgroundRunsForWaitingUsers, 5000);

registerSystemPromptSection('automations', renderAutomationsSection);

(async () => {
    await loadPlugins();
})();

const torrentManager = createTorrentManager(getSettings().torrent);
torrentManager.start().catch(err => {
    log('ERROR', `Failed to start TorrentManager: ${err.message}`);
});

backfillPosters().catch(err => {
    log('ERROR', `Poster backfill failed: ${(err as Error).message}`);
});

const watchlistSettings = getSettings().watchlist;
if (watchlistSettings?.enabled) {
    const intervalMinutes = watchlistSettings.check_interval_minutes || 30;
    startWatchlistRunner(intervalMinutes);
}

const automationEngine = createAutomationEngine();
automationEngine.start();

// The port bind doubles as the single-instance lock: only start WhatsApp once
// it succeeds. A second daemon opening a Baileys socket on the same saved
// credentials makes WhatsApp revoke the device link.
apiServer.on('error', (err: NodeJS.ErrnoException) => {
    log('ERROR', err.code === 'EADDRINUSE'
        ? 'API port already in use — another Fonte daemon is running. Exiting.'
        : `API server error: ${err.message}`);
    process.exit(1);
});
apiServer.on('listening', () => {
    const waAuthDir = path.join(FONTE_HOME, 'whatsapp-auth');
    if (fs.existsSync(waAuthDir) && fs.readdirSync(waAuthDir).length > 0) {
        log('INFO', 'WhatsApp: restoring previous session...');
        getWhatsAppService().start().catch(err => {
            log('ERROR', `WhatsApp auto-start failed: ${(err as Error).message}`);
        });
    }
});

onEvent((type, data) => {
    if (type === 'torrent:completed' && data.id) {
        handleTorrentCompleted(data.id as string).catch(err => {
            log('ERROR', `Subtitle auto-fetch failed for ${data.id}: ${(err as Error).message}`);
        });
    }
});

onEvent(notifyForEvent);

log('INFO', 'Queue processor started (SQLite)');
logAgentConfig();
log('INFO', `Agents: ${Object.keys(getAgents(getSettings())).join(', ')}`);

// Graceful shutdown. Exit code 75 signals "restart" to the Docker entrypoint loop.
// Async teardown (WhatsApp socket close, Transmission sync) must finish before
// process.exit — killing the Baileys socket mid-creds-write leaves the saved
// session inconsistent and WhatsApp answers the next restore with 401.
let shuttingDown = false;
function shutdown(exitCode = 0): void {
    if (shuttingDown) return;
    shuttingDown = true;
    log('INFO', exitCode === 75 ? 'Restarting queue processor...' : 'Shutting down queue processor...');
    stopWatchlistRunner();
    automationEngine.stop();
    clearInterval(pollInterval);
    clearInterval(maintenanceInterval);
    clearInterval(watchdogInterval);
    // Detached CLI children would outlive us as orphans otherwise.
    for (const id of getActiveAgentIds()) killAgentProcess(id);
    apiServer.close();

    const teardown = Promise.allSettled([
        getWhatsAppService().stop(),
        torrentManager.stop(),
    ]);
    const deadline = new Promise<void>(resolve => setTimeout(resolve, 5000).unref());
    Promise.race([teardown, deadline]).then(() => {
        closeQueueDb();
        // On restart the replacement process owns the PID file, so only remove it here.
        if (exitCode !== 75) {
            try { fs.unlinkSync(path.join(FONTE_HOME, 'fonte.pid')); } catch {}
        }
        process.exit(exitCode);
    });
}

process.on('SIGINT', () => { shutdown(); });
process.on('SIGTERM', () => { shutdown(); });
