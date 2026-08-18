"use client";

import { useState } from "react";
import { usePolling, timeAgo } from "@/lib/hooks";
import { formatDuration, formatSeconds } from "@/lib/format";
import {
  getQueueStatus,
  getProcessingMessages,
  killAgentSession,
  getSystemStatus,
  restartService,
  checkConnection,
  getApiBase,
  setApiBase,
  type QueueStatus,
  type ProcessingMessage,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/feedback";
import { LogsPanel } from "@/components/control/logs-panel";
import { LiveEventsPanel } from "@/components/control/live-events-panel";
import {
  Cpu,
  Square,
  ArrowsClockwise,
  X,
  WifiSlash,
  WifiHigh,
  Pencil,
} from "@phosphor-icons/react";

export default function ControlPlanePage() {
  const { data: status, loading, refresh } = usePolling(getSystemStatus, 5000);
  const disconnected = !loading && !status;

  if (disconnected) {
    return <DisconnectedSplash onReconnect={refresh} />;
  }

  return (
    <div className="max-w-(--content-max-w) mx-auto px-6 py-6 space-y-6 animate-card-enter">
      <div>
        <h1 className="text-[40px] leading-none font-black tracking-[-0.03em]">System</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Monitor and manage the daemon
        </p>
      </div>

      <StatsRow />

      <DaemonSection status={status} refresh={refresh} />

      <ApiConnectionSection />

      <AgentSessionsSection />

      <LogsPanel />

      <LiveEventsPanel />
    </div>
  );
}

function DisconnectedSplash({ onReconnect }: { onReconnect: () => void }) {
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [checking, setChecking] = useState(false);

  async function handleConnect() {
    setChecking(true);
    const ok = await checkConnection(apiUrl);
    if (ok) {
      if (apiUrl !== getApiBase()) setApiBase(apiUrl);
      onReconnect();
    }
    setChecking(false);
  }

  function handleReset() {
    const defaultUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3777";
    setApiUrl(defaultUrl);
    setApiBase(null);
  }

  return (
    <div className="p-8">
      <div className="max-w-md mx-auto mt-20 space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <WifiSlash className="h-6 w-6 text-muted-foreground" />
            </div>
          </div>
          <h2 className="text-lg font-semibold">Cannot connect to Fonte</h2>
          <p className="text-sm text-muted-foreground">
            Make sure the daemon is running, or update the server address below.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              placeholder="http://localhost:3777"
              className="flex-1 px-3 py-2 text-sm border bg-background rounded"
            />
            <button
              onClick={handleConnect}
              disabled={checking || !apiUrl}
              className="px-4 py-2 text-sm bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50 rounded"
            >
              {checking ? <Spinner size="xs" /> : "Connect"}
            </button>
          </div>
          {apiUrl !== (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3777") && (
            <button onClick={handleReset} className="text-xs text-muted-foreground hover:text-primary">
              Reset to default
            </button>
          )}
        </div>

        <div className="text-left bg-muted/50 border rounded p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Get started</p>
          <div className="text-sm space-y-1.5">
            <p>1. Follow the installation guide at{" "}
              the project README
            </p>
            <p>2. Run <code className="px-1.5 py-0.5 bg-background border rounded text-xs font-mono">fonte start</code> to start the daemon</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsRow() {
  const { data: queue } = usePolling<QueueStatus>(getQueueStatus, 2000);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <MiniStat label="Incoming" value={queue?.incoming ?? 0} accent={!!queue?.incoming} />
      <MiniStat label="Queued" value={queue?.queued ?? 0} accent={!!queue?.queued} />
      <MiniStat label="Processing" value={queue?.processing ?? 0} accent={!!queue?.processing} />
      <MiniStat label="Outgoing" value={queue?.outgoing ?? 0} />
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 shadow-card">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <p className={`text-2xl font-black tabular-nums mt-0.5 ${value === 0 ? "text-ghost" : accent ? "text-torrent" : ""}`}>{value}</p>
    </div>
  );
}

function DaemonSection({ status, refresh }: { status: any; refresh: () => void }) {
  const [restarting, setRestarting] = useState(false);

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await restartService();
      await new Promise((r) => setTimeout(r, 3000));
      refresh();
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
      refresh();
    } finally {
      setRestarting(false);
    }
  };

  const uptimeStr = formatSeconds(status?.uptime ?? 0);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <p className="text-sm font-semibold">Daemon</p>
            <p className={`text-xs font-extrabold ${status?.ok ? "text-done" : "text-destructive"}`}>
              {status?.ok ? "Running" : "Not responding"}
            </p>
            {status?.ok && (
              <p className="text-xs text-muted-foreground">{`${uptimeStr} · port ${status.server?.port}`}</p>
            )}
          </div>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 rounded"
            title="Restart daemon"
          >
            {restarting ? <Spinner size="xs" /> : <ArrowsClockwise className="h-3.5 w-3.5" />}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function ApiConnectionSection() {
  const [editingUrl, setEditingUrl] = useState(false);
  const [apiUrl, setApiUrl] = useState(getApiBase());
  const [checking, setChecking] = useState(false);

  const handleSave = async () => {
    setChecking(true);
    const ok = await checkConnection(apiUrl);
    if (ok) {
      setApiBase(apiUrl);
      setEditingUrl(false);
    }
    setChecking(false);
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <WifiHigh className="h-3.5 w-3.5 text-done flex-shrink-0" />
            <p className="text-sm font-semibold">API Connection</p>
            {!editingUrl && (
              <p className="text-xs text-muted-foreground">{getApiBase()}</p>
            )}
          </div>
          {!editingUrl ? (
            <button
              onClick={() => { setApiUrl(getApiBase()); setEditingUrl(true); }}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded"
              title="Change server address"
            >
              <Pencil className="h-3 w-3" />
            </button>
          ) : (
            <button
              onClick={() => setEditingUrl(false)}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {editingUrl && (
          <div className="flex gap-2 mt-3">
            <input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="http://localhost:3777"
              className="flex-1 px-2.5 py-1.5 text-sm border bg-background rounded"
            />
            <button
              onClick={handleSave}
              disabled={checking || !apiUrl}
              className="px-3 py-1.5 text-xs bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50 rounded"
            >
              {checking ? <Spinner size="xs" /> : "Save"}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AgentSessionsSection() {
  const { data: processing, refresh: refreshProcessing } =
    usePolling<ProcessingMessage[]>(getProcessingMessages, 3000);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-primary" />
          Agent sessions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {processing && processing.length > 0 ? (
          <div className="space-y-2">
            {processing.map((msg) => (
              <AgentSessionRow
                key={msg.id}
                msg={msg}
                onKill={async () => {
                  await killAgentSession(msg.id);
                  refreshProcessing();
                }}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No active sessions</p>
        )}
      </CardContent>
    </Card>
  );
}

function AgentSessionRow({ msg, onKill }: { msg: ProcessingMessage; onKill: () => Promise<void> }) {
  const [killing, setKilling] = useState(false);
  const isStale = msg.status === "processing" && !msg.processAlive;

  return (
    <div className="group flex items-center justify-between py-2">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-secondary text-2xs font-bold uppercase">
          {msg.agent.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium">@{msg.agent}</p>
            {isStale ? (
              <Badge variant="destructive" className="text-2xs px-1 py-0">stale</Badge>
            ) : msg.status === "processing" ? (
              <Badge variant="default" className="bg-done text-2xs px-1 py-0">processing</Badge>
            ) : (
              <Badge variant="secondary" className="text-2xs px-1 py-0">queued</Badge>
            )}
          </div>
          <p className="text-2xs text-muted-foreground truncate">{msg.message}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <span className="text-2xs text-muted-foreground tabular-nums">{formatDuration(msg.duration)}</span>
        <button
          onClick={async () => { setKilling(true); try { await onKill(); } finally { setKilling(false); } }}
          disabled={killing}
          className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all rounded"
          title="Kill session"
        >
          {killing ? <Spinner size="xs" /> : <Square className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}
