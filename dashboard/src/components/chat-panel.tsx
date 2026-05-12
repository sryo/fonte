"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bot, X, Send } from "lucide-react";
import { getAgentMessages, sendMessage, type AgentMessage } from "@/lib/api";

interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ChatPanel({ open, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Poll for messages when panel is open
  useEffect(() => {
    if (!open) return;

    let mounted = true;

    const fetchMessages = async () => {
      try {
        const data = await getAgentMessages("aitorrent", 50);
        if (mounted) {
          setMessages([...data].reverse());
        }
      } catch {
        // silently fail polling
      }
    };

    fetchMessages();
    const id = setInterval(fetchMessages, 3000);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [open]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCountRef.current = messages.length;
  }, [messages]);

  const handleSend = useCallback(async () => {
    const value = input.trim();
    if (!value || sending) return;

    setSending(true);
    try {
      await sendMessage({
        message: value,
        agent: "aitorrent",
        channel: "web",
        sender: "Web",
      });
      setInput("");
      // Immediately fetch to show the user message
      const data = await getAgentMessages("aitorrent", 50);
      setMessages([...data].reverse());
    } catch {
      // Errors silently handled
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 h-full w-96 z-50 bg-card border-l shadow-xl flex flex-col animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-label="AITorrent Agent Chat"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary/10">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-semibold">AITorrent Agent</span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Close chat panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ overflowAnchor: "none" }}>
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="flex items-center justify-center h-12 w-12 rounded-2xl bg-primary/10 mb-3">
                <Bot className="h-6 w-6 text-primary" />
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
            >
              <div
                className={`px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap break-words ${
                  msg.role === "user"
                    ? "bg-muted rounded-xl rounded-br-sm ml-auto"
                    : "bg-card border rounded-xl rounded-bl-sm"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

          <div ref={messagesEndRef} style={{ overflowAnchor: "auto" }} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t flex gap-2 shrink-0">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            placeholder="Type a message..."
            disabled={sending}
            className="flex-1 bg-muted/50 rounded-lg border px-3 py-2 text-sm placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all disabled:opacity-60"
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}
