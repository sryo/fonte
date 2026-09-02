"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog } from "radix-ui";
import { ArrowUp, PencilSimple, Robot, Square, X } from "@phosphor-icons/react";
import { formatClock } from "@/lib/format";
import { useAgentChat, type ChatMessage } from "@/hooks/use-agent-chat";
import { Button } from "@/components/ui/button";
import { IconSwap } from "@/components/ui/icon-swap";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { Markdown } from "@/components/ui/markdown";
import {
  EventNote,
  QueuedRow,
  SendStatus,
  SystemNote,
  ToolActivity,
} from "@/components/agent/tool-activity";
import { parseEventRow } from "@/lib/agent-activity";
import { cn } from "@/lib/utils";

const AGENT_ID = "fonte";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

function Elapsed({ since }: { since: number }) {
  const [label, setLabel] = useState("0:00");
  useEffect(() => {
    const update = () => setLabel(formatClock(Date.now() - since));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [since]);
  return <span className="tabular-nums text-muted-foreground">{label}</span>;
}

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
  } = useAgentChat(AGENT_ID, { active: open, limit: 50 });

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      }, 100);
    }
  }, [open]);

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

  const lastItem = items[items.length - 1];
  const stopMode = run != null && !input.trim();

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
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
          <Dialog.Title className="text-2xl font-black tracking-tight">Fonte Agent</Dialog.Title>
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

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="flex items-center justify-center h-12 w-12 rounded-2xl bg-primary/10 mb-3">
                <Robot className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">No messages yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Ask the agent anything below
              </p>
            </div>
          )}

          {items.map((item) => {
            if (item.type === "tools") {
              return (
                <div key={item.key} className="flex justify-start" style={{ overflowAnchor: "none" }}>
                  <ToolActivity calls={item.calls} live={run != null && item === lastItem} />
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
            return (
              <div
                key={msg.id}
                className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}
                style={{ overflowAnchor: "none" }}
              >
                <div className={`group/bubble flex items-end gap-1 ${isUser ? "justify-end" : "justify-start"}`}>
                  {isUser && msg.id === editableRowId && (
                    <button
                      type="button"
                      onClick={() => beginEdit(msg)}
                      aria-label="Edit and rerun"
                      title="Edit and rerun"
                      className="mb-1 rounded p-1 text-foreground opacity-0 transition-all group-hover/bubble:opacity-50 hover:opacity-100 focus-visible:opacity-100"
                    >
                      <PencilSimple className="size-4" />
                    </button>
                  )}
                  <div
                    className={cn(
                      "px-3 py-2 text-sm max-w-[80%] break-words",
                      isUser
                        ? "bg-muted font-medium rounded-xl rounded-br-sm whitespace-pre-wrap"
                        : "bg-card border rounded-xl rounded-bl-sm prose prose-sm dark:prose-invert max-w-none",
                      editingRowId === msg.id && "ring-2 ring-ring/50",
                      msg.local?.phase === "pending" && "opacity-60"
                    )}
                  >
                    {isUser ? msg.content : <Markdown>{msg.content}</Markdown>}
                  </div>
                </div>
                {msg.local && msg.local.phase !== "queued" && msg.message_id && (
                  <SendStatus
                    phase={msg.local.phase}
                    error={msg.local.error}
                    onRetry={() => retry(msg.message_id!)}
                    onDiscard={() => discard(msg.message_id!)}
                    className="pr-1"
                  />
                )}
              </div>
            );
          })}

          <div ref={messagesEndRef} style={{ overflowAnchor: "auto" }} />
        </div>

        <div className="border-t shrink-0">
          {run && (
            <div className="flex items-baseline gap-2.5 px-4 pt-2 text-xs">
              <span className="shimmer-text font-extrabold" data-text="Working…">Working…</span>
              <span className="font-black text-ghost tabular-nums">
                <Elapsed since={run.startedAt} />
              </span>
            </div>
          )}
          {editingRowId != null && (
            <div className="flex items-center justify-between px-4 pt-2 text-xs text-muted-foreground">
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
          <div className="px-4 py-3">
            <PromptInput
              value={input}
              onValueChange={setInput}
              isLoading={sending}
              onSubmit={handleSend}
              disabled={sending}
              className="flex items-end gap-2 border-0 bg-muted p-1.5 pl-3.5"
            >
              <PromptInputTextarea
                ref={inputRef}
                placeholder={editingRowId != null ? "Edit your message…" : "Type a message..."}
                className="min-h-0 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Escape" && editingRowId != null) {
                    e.stopPropagation();
                    endEdit();
                  }
                }}
              />
              <PromptInputActions className="h-9">
                <PromptInputAction
                  tooltip={stopMode ? "Stop the agent" : sending ? "Sending..." : "Send message"}
                >
                  <Button
                    variant="default"
                    size="icon"
                    className="h-9 w-9 rounded-full"
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
              <div className="mt-2 space-y-1">
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
