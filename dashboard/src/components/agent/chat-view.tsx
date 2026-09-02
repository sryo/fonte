"use client";

import { useState, useCallback, useRef } from "react";
import { IconSwap } from "@/components/ui/icon-swap";
import { timeAgo } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import {
  ChatContainerRoot,
  ChatContainerContent,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { Markdown } from "@/components/ui/markdown";
import { Robot, ArrowUp, PencilSimple, Square } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { agentColor } from "@/lib/agent-colors";
import { parseEventRow } from "@/lib/agent-activity";
import { useAgentChat, type ChatMessage } from "@/hooks/use-agent-chat";
import {
  EventNote,
  QueuedRow,
  SendStatus,
  SystemNote,
  ToolActivity,
} from "@/components/agent/tool-activity";

export function AgentChatView({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const {
    messages,
    items,
    run,
    stopping,
    stop,
    queued,
    cancellingId,
    cancelQueued,
    send,
    retry,
    discard,
    sending,
    editingRowId,
    editableRowId,
    startEditing,
    cancelEditing,
    error: pollError,
  } = useAgentChat(agentId, { active: true, limit: 200 });

  const beginEdit = useCallback(
    (msg: ChatMessage) => {
      if (typeof msg.id !== "number") return;
      startEditing(msg.id);
      setInput(msg.content);
      inputRef.current?.focus();
    },
    [startEditing]
  );

  const endEdit = useCallback(() => {
    cancelEditing();
    setInput("");
  }, [cancelEditing]);

  const handleSend = useCallback(() => {
    const value = input.trim();
    if (!value || sending) return;
    setInput("");
    void send(value);
  }, [input, sending, send]);

  const lastChatItem = items[items.length - 1];
  const stopMode = run != null && !input.trim();

  return (
    <div className="flex h-full flex-col relative">
      <div className="absolute top-3 right-4 z-10 flex items-center gap-1.5">
        <div className={cn("h-1.5 w-1.5", pollError ? "bg-destructive" : "bg-primary animate-pulse-dot")} />
        <span className="text-2xs text-muted-foreground">
          {pollError ? "Disconnected" : "Connected"}
        </span>
      </div>

      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <Robot className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            Send a message to {agentName} to get started
          </p>
        </div>
      ) : (
        <ChatContainerRoot className="flex-1">
          <ChatContainerContent className="space-y-3 px-6 pt-4 pb-28">
            {items.map((item) => {
              if (item.type === "tools") {
                return (
                  <div key={item.key} className="pl-11">
                    <ToolActivity calls={item.calls} live={run != null && item === lastChatItem} />
                  </div>
                );
              }
              if (item.type === "system") {
                return <SystemNote key={item.row.id}>{item.row.content}</SystemNote>;
              }
              if (item.type === "event") {
                const event = parseEventRow(item.row);
                return event ? (
                  <EventNote key={item.row.id} event={event} />
                ) : (
                  <SystemNote key={item.row.id}>{item.row.content}</SystemNote>
                );
              }
              const msg = item.row;
              const isUser = msg.role === "user";
              const label = isUser ? "You" : agentName;
              const initials = label.slice(0, 2).toUpperCase();
              return (
                <div
                  key={msg.id}
                  className={cn(
                    "group/bubble flex items-start gap-3",
                    msg.local?.phase === "pending" && "opacity-60",
                    editingRowId === msg.id && "ring-2 ring-ring/50 rounded-md -mx-2 px-2 py-1"
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center text-2xs font-bold uppercase shrink-0",
                      isUser ? "bg-primary text-primary-foreground" : `${agentColor(agentId)} text-white`
                    )}
                  >
                    {isUser ? "You" : initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold">{label}</span>
                      <span className="text-2xs text-muted-foreground">
                        {timeAgo(msg.created_at)}
                      </span>
                      {isUser && msg.id === editableRowId && (
                        <button
                          type="button"
                          onClick={() => beginEdit(msg)}
                          aria-label="Edit and rerun"
                          title="Edit and rerun"
                          className="rounded p-0.5 text-foreground opacity-0 transition-all group-hover/bubble:opacity-50 hover:opacity-100 focus-visible:opacity-100"
                        >
                          <PencilSimple className="size-3.5" />
                        </button>
                      )}
                    </div>
                    <Markdown className="prose prose-sm dark:prose-invert mt-0.5 max-w-none break-words text-foreground/90">
                      {msg.content}
                    </Markdown>
                    {msg.local && msg.local.phase !== "queued" && msg.message_id && (
                      <SendStatus
                        phase={msg.local.phase}
                        error={msg.local.error}
                        onRetry={() => retry(msg.message_id!)}
                        onDiscard={() => discard(msg.message_id!)}
                        className="mt-1"
                      />
                    )}
                  </div>
                </div>
              );
            })}
            <ChatContainerScrollAnchor />
          </ChatContainerContent>
        </ChatContainerRoot>
      )}

      <div className="absolute bottom-4 left-6 right-6 z-10 space-y-2">
        {editingRowId != null && (
          <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span>Editing. Reruns from here</span>
            <button
              type="button"
              onClick={endEdit}
              className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
        <PromptInput
          value={input}
          onValueChange={setInput}
          isLoading={sending}
          onSubmit={handleSend}
          className="relative w-full shadow-md"
        >
          <PromptInputTextarea
            ref={inputRef}
            placeholder={editingRowId != null ? "Edit your message…" : `Message ${agentName}...`}
            className="min-h-[70px]"
            onKeyDown={(e) => {
              if (e.key === "Escape" && editingRowId != null) {
                e.stopPropagation();
                endEdit();
              }
            }}
          />
          <PromptInputActions className="absolute bottom-2 right-2">
            <PromptInputAction
              tooltip={stopMode ? "Stop the agent" : sending ? "Sending..." : "Send message"}
            >
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-full"
                disabled={stopMode ? stopping : !input.trim() || sending}
                onClick={stopMode ? stop : handleSend}
              >
                <IconSwap
                  active={stopMode || sending ? "stop" : "send"}
                  icons={{
                    send: <ArrowUp className="size-5" />,
                    stop: <Square className="size-5" weight="fill" />,
                  }}
                />
              </Button>
            </PromptInputAction>
          </PromptInputActions>
        </PromptInput>
        {queued.length > 0 && (
          <div className="space-y-1 rounded-md border bg-card px-3 py-2">
            {queued.map((q) => (
              <QueuedRow
                key={q.key}
                content={q.content}
                onCancel={q.queueId != null ? () => cancelQueued(q.queueId!) : undefined}
                cancelling={q.queueId != null && cancellingId === q.queueId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
