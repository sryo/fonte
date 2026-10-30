"use client";

import { Dialog } from "radix-ui";
import { X } from "@phosphor-icons/react";
import { useAgentChat } from "@/hooks/use-agent-chat";
import { AgentComposer, AgentTranscript, useChatComposer } from "@/components/agent/conversation";

const AGENT_ID = "fonte";
const AGENT_NAME = "Fonte Agent";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const chat = useAgentChat(AGENT_ID, { active: open, limit: 50 });
  const composer = useChatComposer(chat);

  return (
    // Radix Presence keeps the portal mounted until the data-state=closed
    // animation finishes.
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40 bg-black/20 data-[state=open]:animate-backdrop-in data-[state=closed]:animate-backdrop-out"
        />

        <Dialog.Content
          className="fixed right-0 top-0 h-full w-96 z-50 bg-card border-l flex flex-col outline-none data-[state=open]:animate-chat-panel-in data-[state=closed]:animate-chat-panel-out"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            if (composer.recall.isBrowsing()) e.preventDefault();
          }}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            composer.inputRef.current?.focus();
          }}
        >
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
          <Dialog.Title className="text-2xl font-black tracking-tight">{AGENT_NAME}</Dialog.Title>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close chat panel"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <AgentTranscript
          chat={chat}
          layout="panel"
          agentId={AGENT_ID}
          agentName={AGENT_NAME}
          onEdit={composer.beginEdit}
        />
        <AgentComposer chat={chat} composer={composer} layout="panel" agentName={AGENT_NAME} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
