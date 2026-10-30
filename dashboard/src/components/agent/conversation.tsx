"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, PencilSimple, Robot, Square } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { IconSwap } from "@/components/ui/icon-swap";
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container";
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
import { useAgentChat, type ChatMessage } from "@/hooks/use-agent-chat";
import { useInputHistory } from "@/hooks/use-input-history";
import { modKeyLabel, useIsMac } from "@/hooks/use-platform";
import { Kbd } from "@/components/ui/kbd";
import { parseEventRow } from "@/lib/agent-activity";
import { agentColor } from "@/lib/agent-colors";
import { formatClock } from "@/lib/format";
import { timeAgo } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export type AgentChat = ReturnType<typeof useAgentChat>;

export type ConversationLayout = "panel" | "page";

export function composerButton({
  running,
  input,
  sending,
  stopping,
}: {
  running: boolean;
  input: string;
  sending: boolean;
  stopping: boolean;
}) {
  const stopMode = running && !input.trim();
  const queues = running && !stopMode && !sending;
  return {
    mode: stopMode ? ("stop" as const) : ("send" as const),
    icon: stopMode || sending ? ("stop" as const) : ("send" as const),
    tooltip: stopMode ? "Stop the agent" : sending ? "Sending..." : queues ? "Queue message" : "Send message",
    disabled: stopMode ? stopping : !input.trim() || sending,
    sendNow: queues,
  };
}

export function isStopAndSend(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  { running, input }: { running: boolean; input: string }
): boolean {
  return (
    e.key === "Enter" &&
    (e.metaKey || e.ctrlKey) &&
    !e.shiftKey &&
    !e.altKey &&
    running &&
    input.trim().length > 0
  );
}

export function useChatComposer(chat: AgentChat) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { startEditing, cancelEditing, send, sending, sentHistory, editingRowId } = chat;
  const recall = useInputHistory(sentHistory, input, setInput, editingRowId == null);

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

  const submit = useCallback(
    (now = false) => {
      const value = input.trim();
      if (!value || sending) return;
      setInput("");
      void send(value, { now });
    },
    [input, sending, send]
  );

  return { input, setInput, inputRef, recall, beginEdit, endEdit, submit };
}

export type ChatComposer = ReturnType<typeof useChatComposer>;

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

function EditButton({ onClick, className }: { onClick: () => void; className: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Edit and rerun"
      title="Edit and rerun"
      className={cn(
        "rounded text-foreground opacity-0 transition-all group-hover/bubble:opacity-50 hover:opacity-100 focus-visible:opacity-100",
        className
      )}
    >
      <PencilSimple className="size-full" />
    </button>
  );
}

interface RowProps {
  msg: ChatMessage;
  chat: AgentChat;
  onEdit: (msg: ChatMessage) => void;
  agentId: string;
  agentName: string;
}

function MessageStatus({ msg, chat, className }: { msg: ChatMessage; chat: AgentChat; className: string }) {
  if (!msg.local || msg.local.phase === "queued" || !msg.message_id) return null;
  const messageId = msg.message_id;
  return (
    <SendStatus
      phase={msg.local.phase}
      error={msg.local.error}
      onRetry={() => chat.retry(messageId)}
      onDiscard={() => chat.discard(messageId)}
      className={className}
    />
  );
}

function BubbleRow({ msg, chat, onEdit }: RowProps) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      <div className={cn("group/bubble flex items-end gap-1", isUser ? "justify-end" : "justify-start")}>
        {isUser && msg.id === chat.editableRowId && (
          <EditButton onClick={() => onEdit(msg)} className="mb-1 size-6 p-1" />
        )}
        <div
          className={cn(
            "px-3 py-2 text-sm max-w-[80%] break-words",
            isUser
              ? "bg-muted font-medium rounded-xl rounded-br-sm whitespace-pre-wrap"
              : "bg-card border rounded-xl rounded-bl-sm prose prose-sm dark:prose-invert max-w-none",
            chat.editingRowId === msg.id && "ring-2 ring-ring/50",
            msg.local?.phase === "pending" && "opacity-60"
          )}
        >
          {isUser ? msg.content : <Markdown>{msg.content}</Markdown>}
        </div>
      </div>
      <MessageStatus msg={msg} chat={chat} className="pr-1" />
    </div>
  );
}

function AuthorRow({ msg, chat, onEdit, agentId, agentName }: RowProps) {
  const isUser = msg.role === "user";
  const label = isUser ? "You" : agentName;
  return (
    <div
      className={cn(
        "group/bubble flex items-start gap-3",
        msg.local?.phase === "pending" && "opacity-60",
        chat.editingRowId === msg.id && "ring-2 ring-ring/50 rounded-md -mx-2 px-2 py-1"
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 items-center justify-center text-2xs font-bold uppercase shrink-0",
          isUser ? "bg-primary text-primary-foreground" : `${agentColor(agentId)} text-white`
        )}
      >
        {isUser ? "You" : label.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{label}</span>
          <span className="text-2xs text-muted-foreground">{timeAgo(msg.created_at)}</span>
          {isUser && msg.id === chat.editableRowId && (
            <EditButton onClick={() => onEdit(msg)} className="size-[1.125rem] p-0.5" />
          )}
        </div>
        <Markdown className="prose prose-sm dark:prose-invert mt-0.5 max-w-none break-words text-foreground/90">
          {msg.content}
        </Markdown>
        <MessageStatus msg={msg} chat={chat} className="mt-1" />
      </div>
    </div>
  );
}

export function AgentTranscript({
  chat,
  layout,
  agentId,
  agentName,
  onEdit,
}: {
  chat: AgentChat;
  layout: ConversationLayout;
  agentId: string;
  agentName: string;
  onEdit: (msg: ChatMessage) => void;
}) {
  const { messages, items, run, failureRetry } = chat;

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Robot className="mb-3 h-8 w-8 text-ghost" />
        <p className="text-sm font-medium text-foreground">No messages yet</p>
        <p className="text-xs text-muted-foreground mt-1">Ask the agent anything below</p>
      </div>
    );
  }

  const lastItem = items[items.length - 1];
  const Row = layout === "panel" ? BubbleRow : AuthorRow;

  return (
    <ChatContainerRoot className="min-h-0 flex-1">
      <ChatContainerContent className={cn("space-y-3", layout === "panel" ? "px-4 py-3" : "px-6 pt-4 pb-28")}>
        {items.map((item) => {
          if (item.type === "tools") {
            return (
              <div key={item.key} className={layout === "panel" ? "flex justify-start" : "pl-11"}>
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
              <EventNote key={item.row.id} event={event} retry={failureRetry(item.row, event)} />
            ) : (
              <SystemNote key={item.row.id}>{item.row.content}</SystemNote>
            );
          }
          return (
            <Row
              key={item.row.id}
              msg={item.row}
              chat={chat}
              onEdit={onEdit}
              agentId={agentId}
              agentName={agentName}
            />
          );
        })}
        <ChatContainerScrollAnchor />
      </ChatContainerContent>
    </ChatContainerRoot>
  );
}

export function AgentComposer({
  chat,
  composer,
  layout,
  agentName,
}: {
  chat: AgentChat;
  composer: ChatComposer;
  layout: ConversationLayout;
  agentName: string;
}) {
  const { run, stopping, stop, queued, cancellingId, cancelQueued, sending, editingRowId, disconnected } = chat;
  const { input, setInput, inputRef, recall, endEdit, submit } = composer;
  const button = composerButton({ running: run != null, input, sending, stopping });
  const mod = modKeyLabel(useIsMac());
  const panel = layout === "panel";
  const inset = panel ? "px-4 pt-2" : "px-1";

  const working = run && (
    <div className={cn("flex items-baseline gap-2.5 text-xs", inset)}>
      <span className="shimmer-text font-extrabold" data-text="Working…">Working…</span>
      <span className="font-black text-ghost tabular-nums">
        <Elapsed since={run.startedAt} />
      </span>
    </div>
  );

  const unreachable = disconnected && (
    <div role="status" className={cn("flex items-center gap-2 text-xs text-muted-foreground", inset)}>
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 bg-destructive" />
      Can&apos;t reach the daemon. Messages send when it&apos;s back.
    </div>
  );

  const editing = editingRowId != null && (
    <div className={cn("flex items-center justify-between text-xs text-muted-foreground", inset)}>
      <span>Editing. Reruns from here</span>
      <button
        type="button"
        onClick={endEdit}
        className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground transition-colors"
      >
        Cancel
      </button>
    </div>
  );

  const prompt = (
    <PromptInput
      value={input}
      onValueChange={setInput}
      isLoading={sending}
      onSubmit={() => submit()}
      className={panel ? "flex items-end gap-2 border-0 bg-muted p-1.5 pl-3.5" : "relative w-full shadow-md"}
    >
      <PromptInputTextarea
        ref={inputRef}
        placeholder={editingRowId != null ? "Edit your message…" : `Message ${agentName}…`}
        className={panel ? "min-h-0 text-sm" : "min-h-[70px]"}
        onKeyDown={(e) => {
          if (recall.onKeyDown(e)) return;
          if (isStopAndSend(e, { running: run != null, input })) {
            e.preventDefault();
            submit(true);
            return;
          }
          if (e.key === "Escape" && editingRowId != null) {
            e.stopPropagation();
            endEdit();
          }
        }}
      />
      <PromptInputActions className={panel ? "h-9" : "absolute bottom-2 right-2"}>
        <PromptInputAction
          tooltip={
            button.sendNow ? (
              <span className="flex flex-col gap-1">
                <span>{button.tooltip}</span>
                <span className="flex items-center gap-1.5">
                  Stop and send now
                  <Kbd className="bg-background/20 text-background">{mod}↵</Kbd>
                </span>
              </span>
            ) : (
              button.tooltip
            )
          }
        >
          <Button
            variant="default"
            size="icon"
            className={cn("rounded-full", panel ? "h-9 w-9" : "h-8 w-8")}
            disabled={button.disabled}
            onClick={button.mode === "stop" ? stop : () => submit()}
          >
            <IconSwap
              active={button.icon}
              icons={{
                send: <ArrowUp className="size-5" />,
                stop: <Square className="size-5" weight="fill" />,
              }}
            />
          </Button>
        </PromptInputAction>
      </PromptInputActions>
    </PromptInput>
  );

  const queuedList = queued.length > 0 && (
    <div className={panel ? "mt-2 space-y-1" : "space-y-1 rounded-md border bg-card px-3 py-2"}>
      {queued.map((q) => (
        <QueuedRow
          key={q.key}
          content={q.content}
          onCancel={q.queueId != null ? () => cancelQueued(q.queueId!) : undefined}
          cancelling={q.queueId != null && cancellingId === q.queueId}
        />
      ))}
    </div>
  );

  if (panel) {
    return (
      <div className="border-t shrink-0">
        {unreachable}
        {working}
        {editing}
        <div className="px-4 py-3">
          {prompt}
          {queuedList}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 left-6 right-6 z-10 space-y-2">
      {unreachable}
      {working}
      {editing}
      {prompt}
      {queuedList}
    </div>
  );
}
