"use client";

import { cn } from "@/lib/utils";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { AgentComposer, AgentTranscript, useChatComposer } from "@/components/agent/conversation";

export function AgentChatView({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const chat = useAgentChat(agentId, { active: true, limit: 200 });
  const composer = useChatComposer(chat);

  return (
    <div className="flex h-full flex-col relative">
      <div className="absolute top-3 right-4 z-10 flex items-center gap-1.5">
        <div className={cn("h-1.5 w-1.5", chat.error ? "bg-destructive" : "bg-primary animate-pulse-dot")} />
        <span className="text-2xs text-muted-foreground">
          {chat.error ? "Disconnected" : "Connected"}
        </span>
      </div>

      <AgentTranscript
        chat={chat}
        layout="page"
        agentId={agentId}
        agentName={agentName}
        onEdit={composer.beginEdit}
      />
      <AgentComposer chat={chat} composer={composer} layout="page" agentName={agentName} />
    </div>
  );
}
