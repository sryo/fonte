"use client";

import { useState, useCallback, useEffect, use } from "react";
import { usePolling } from "@/lib/hooks";
import {
  getAgents,
  getAgentSystemPrompt,
  saveAgentSystemPrompt,
  getAgentHeartbeat,
  saveAgentHeartbeat,
  type AgentConfig,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AgentChatView,
  ScheduleTab,
  SystemPromptTab,
  HeartbeatTab,
} from "@/components/agent";
import {
  Robot,
  FileText,
  Heartbeat,
  CalendarDots,
  ArrowLeft,
} from "@phosphor-icons/react";

const AGENT_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-purple-500", "bg-orange-500",
  "bg-pink-500", "bg-cyan-500", "bg-yellow-500", "bg-red-500",
];

function agentColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}
import Link from "next/link";

type TabId = "chat" | "schedule" | "system-prompt" | "heartbeat";

const TABS: { id: TabId; label: string; icon: typeof Robot }[] = [
  { id: "chat", label: "Chat", icon: Robot },
  { id: "schedule", label: "Schedule", icon: CalendarDots },
  { id: "system-prompt", label: "System Prompt", icon: FileText },
  { id: "heartbeat", label: "Heartbeat", icon: Heartbeat },
];

export default function AgentConfigPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: agentId } = use(params);
  const { data: agents } = usePolling<Record<string, AgentConfig>>(
    getAgents,
    0,
  );

  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const [spSaving, setSpSaving] = useState(false);
  const [spSaved, setSpSaved] = useState(false);
  const [hbSaving, setHbSaving] = useState(false);
  const [hbSaved, setHbSaved] = useState(false);

  // Workspace data
  const [systemPromptContent, setSystemPromptContent] = useState<string>("");
  const [systemPromptPath, setSystemPromptPath] = useState<string>("");
  const [systemPromptLoaded, setSystemPromptLoaded] = useState(false);
  const [heartbeatContent, setHeartbeatContent] = useState<string>("");
  const [heartbeatPath, setHeartbeatPath] = useState<string>("");
  const [heartbeatLoaded, setHeartbeatLoaded] = useState(false);

  // Heartbeat UI state
  const [heartbeatInterval, setHeartbeatInterval] = useState("300");
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);

  const agent = agents?.[agentId];

  // Load workspace data when agent is available
  useEffect(() => {
    if (!agent) return;

    getAgentSystemPrompt(agentId)
      .then((data) => {
        setSystemPromptContent(data.content);
        setSystemPromptPath(data.path);
        setSystemPromptLoaded(true);
      })
      .catch(() => setSystemPromptLoaded(true));

    getAgentHeartbeat(agentId)
      .then((data) => {
        setHeartbeatContent(data.content);
        setHeartbeatPath(data.path);
        setHeartbeatEnabled(data.enabled);
        if (data.interval != null) {
          setHeartbeatInterval(String(data.interval));
        }
        setHeartbeatLoaded(true);
      })
      .catch(() => setHeartbeatLoaded(true));
  }, [agent, agentId]);

  const handleSaveSystemPrompt = useCallback(async () => {
    if (!agent) return;
    setSpSaving(true);
    try {
      await saveAgentSystemPrompt(agentId, systemPromptContent);
      setSpSaved(true);
      setTimeout(() => setSpSaved(false), 2000);
    } catch {
      // Error handling
    } finally {
      setSpSaving(false);
    }
  }, [agent, agentId, systemPromptContent]);

  const handleSaveHeartbeat = useCallback(async () => {
    if (!agent) return;
    setHbSaving(true);
    try {
      await saveAgentHeartbeat(agentId, {
        content: heartbeatContent,
        enabled: heartbeatEnabled,
        interval: parseInt(heartbeatInterval) || 300,
      });
      setHbSaved(true);
      setTimeout(() => setHbSaved(false), 2000);
    } catch {
      // Error handling
    } finally {
      setHbSaving(false);
    }
  }, [agent, agentId, heartbeatContent, heartbeatEnabled, heartbeatInterval]);

  if (!agents) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin border-2 border-primary border-t-transparent" />
          Loading...
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-12 text-center">
            <Robot className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium">Agent not found</p>
            <p className="text-sm text-muted-foreground mt-1">
              No agent with ID &quot;{agentId}&quot; exists
            </p>
            <Link href="/agents">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="h-4 w-4" />
                Back to Agents
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6 animate-card-enter">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/agents"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-3">
            <div className={cn("flex h-10 w-10 items-center justify-center text-white text-sm font-bold uppercase", agentColor(agentId))}>
              {agent.name.slice(0, 2)}
            </div>
            <div>
              <h1 className="text-base font-semibold flex items-center gap-2">
                {agent.name}
                <Badge variant="outline" className="text-[10px] font-mono">
                  @{agentId}
                </Badge>
              </h1>
              <p className="text-xs text-muted-foreground">
                {agent.provider}/{agent.model}
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* Tabs */}
      <div className="flex items-center border-b">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <Button
              key={tab.id}
              variant="ghost"
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors rounded-none
                border-b-2 -mb-px h-auto
                ${
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-transparent"
                }
              `}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </Button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "chat" && (
          <div className="h-full min-h-0">
            <AgentChatView agentId={agentId} agentName={agent.name} />
          </div>
        )}
        {activeTab === "schedule" && (
          <ScheduleTab agentId={agentId} />
        )}
        {activeTab === "system-prompt" && (
          <SystemPromptTab
            content={systemPromptContent}
            filePath={systemPromptPath}
            loaded={systemPromptLoaded}
            onChange={setSystemPromptContent}
            onSave={handleSaveSystemPrompt}
            saving={spSaving}
            saved={spSaved}
          />
        )}
        {activeTab === "heartbeat" && (
          <HeartbeatTab
            content={heartbeatContent}
            filePath={heartbeatPath}
            loaded={heartbeatLoaded}
            onChange={setHeartbeatContent}
            enabled={heartbeatEnabled}
            onToggle={() => setHeartbeatEnabled(!heartbeatEnabled)}
            interval={heartbeatInterval}
            onIntervalChange={setHeartbeatInterval}
            onSave={handleSaveHeartbeat}
            saving={hbSaving}
            saved={hbSaved}
          />
        )}
      </div>
    </div>
  );
}
