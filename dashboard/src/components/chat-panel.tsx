"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Dialog } from "radix-ui";
import { Robot, X, PaperPlaneTilt } from "@phosphor-icons/react";
import { getAgentMessages, sendMessage, type AgentMessage } from "@/lib/api";
import { Markdown } from "@/components/ui/markdown";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    let active = true;

    const fetchMessages = async () => {
      try {
        const data = await getAgentMessages("fonte", 50);
        if (active) {
          const reversed = [...data].reverse();
          setMessages((prev) => {
            if (reversed.length > prev.length) {
              setThinking(false);
            }
            return reversed;
          });
        }
      } catch {
        // silently fail polling
      }
    };

    fetchMessages();
    const id = setInterval(fetchMessages, 3000);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      }, 100);
    }
  }, [open]);

  const handleSend = useCallback(async () => {
    const value = input.trim();
    if (!value || sending) return;

    setSending(true);
    setThinking(true);
    try {
      await sendMessage({
        message: value,
        agent: "fonte",
        channel: "web",
        sender: "Web",
      });
      setInput("");
      // Fetch right away so the user's own message shows before the next poll.
      const data = await getAgentMessages("fonte", 50);
      setMessages([...data].reverse());
    } catch {
      setThinking(false);
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  return (
    // Radix Presence keeps the portal mounted until the data-state=closed
    // animation finishes, so the exit slide plays without manual timers.
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40 bg-black/20 data-[state=open]:animate-chat-backdrop-in data-[state=closed]:animate-chat-backdrop-out"
        />

        <Dialog.Content
          className="fixed right-0 top-0 h-full w-96 z-50 bg-card border-l shadow-xl flex flex-col outline-none data-[state=open]:animate-chat-panel-in data-[state=closed]:animate-chat-panel-out"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center h-7 w-7 rounded-md bg-primary/10">
              <Robot className="h-4 w-4 text-primary" />
            </div>
            <Dialog.Title className="text-sm font-semibold">Fonte Agent</Dialog.Title>
          </div>
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

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              style={{ overflowAnchor: "none" }}
            >
              <div
                className={`px-3 py-2 text-sm max-w-[80%] break-words ${
                  msg.role === "user"
                    ? "bg-muted rounded-xl rounded-br-sm ml-auto whitespace-pre-wrap"
                    : "bg-card border rounded-xl rounded-bl-sm prose prose-sm dark:prose-invert max-w-none"
                }`}
              >
                {msg.role === "user" ? msg.content : <Markdown>{msg.content}</Markdown>}
              </div>
            </div>
          ))}

          {thinking && (
            <div className="flex justify-start">
              <div className="bg-card border rounded-xl rounded-bl-sm px-3 py-2 text-sm text-muted-foreground flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse" />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse" style={{animationDelay: "0.2s"}} />
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse" style={{animationDelay: "0.4s"}} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} style={{ overflowAnchor: "auto" }} />
        </div>

        <div className="px-4 py-3 border-t flex gap-2 shrink-0">
          <input
            type="text"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            placeholder="Type a message..."
            disabled={sending}
            className="flex-1 bg-muted/50 rounded-md border px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="flex items-center justify-center h-9 w-9 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
            aria-label="Send message"
          >
            <PaperPlaneTilt className="h-4 w-4" />
          </button>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
