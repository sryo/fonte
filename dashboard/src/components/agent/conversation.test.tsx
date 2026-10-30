import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessage } from "@/hooks/use-agent-chat";
import {
  AgentComposer,
  AgentTranscript,
  composerButton,
  isStopAndSend,
  useChatComposer,
  type AgentChat,
  type ConversationLayout,
} from "./conversation";

const noop = () => {};

function fakeChat(overrides: Partial<AgentChat> = {}): AgentChat {
  return {
    messages: [],
    items: [],
    run: null,
    stopping: false,
    stop: noop,
    queued: [],
    cancellingId: null,
    cancelQueued: noop,
    send: async () => {},
    retry: noop,
    discard: noop,
    sending: false,
    editingRowId: null,
    editableRowId: undefined,
    startEditing: noop,
    cancelEditing: noop,
    reset: async () => {},
    refresh: async () => {},
    failureRetry: () => undefined,
    sentHistory: [],
    error: null,
    ...overrides,
  } as unknown as AgentChat;
}

function row(id: number, role: ChatMessage["role"], content: string): ChatMessage {
  return { id, role, content, created_at: 1_790_000_000_000, channel: "web" };
}

function withMessages(rows: ChatMessage[], overrides: Partial<AgentChat> = {}): AgentChat {
  return fakeChat({
    messages: rows,
    items: rows.map((r) => ({ type: "msg" as const, row: r })),
    ...overrides,
  });
}

const layouts: ConversationLayout[] = ["panel", "page"];

function transcript(chat: AgentChat, layout: ConversationLayout) {
  return renderToStaticMarkup(
    <AgentTranscript chat={chat} layout={layout} agentId="fonte" agentName="Fonte Agent" onEdit={noop} />
  );
}

function Composer({ chat, layout }: { chat: AgentChat; layout: ConversationLayout }) {
  const composer = useChatComposer(chat);
  return <AgentComposer chat={chat} composer={composer} layout={layout} agentName="Fonte Agent" />;
}

const composer = (chat: AgentChat, layout: ConversationLayout) =>
  renderToStaticMarkup(<Composer chat={chat} layout={layout} />);

describe.each(layouts)("AgentTranscript (%s)", (layout) => {
  it("keeps the newest message in view", () => {
    const html = transcript(withMessages([row(1, "user", "find dune"), row(2, "assistant", "Added it.")]), layout);
    expect(html).toContain('role="log"');
    expect(html).toContain("find dune");
    expect(html).toContain("Added it.");
  });

  it("offers edit and rerun on the editable row only", () => {
    const chat = withMessages(
      [row(1, "user", "first"), row(2, "assistant", "ok"), row(3, "user", "second")],
      { editableRowId: 3 }
    );
    expect(transcript(chat, layout).match(/aria-label="Edit and rerun"/g)).toHaveLength(1);
  });

  it("holds back the pending look of a fresh send but shows a failure at once", () => {
    const pending: ChatMessage = { ...row(1, "user", "hello"), message_id: "m1", local: { phase: "pending" } };
    const failed: ChatMessage = { ...row(2, "user", "again"), message_id: "m2", local: { phase: "failed", error: "rejected" } };
    const html = transcript(withMessages([pending, failed]), layout);
    expect(html).not.toContain("opacity-60");
    expect(html).not.toContain("Sending");
    expect(html).toContain("Couldn&#x27;t send");
  });

  it("shows the same empty state", () => {
    const html = transcript(fakeChat(), layout);
    expect(html).toContain("No messages yet");
    expect(html).toContain("Ask the agent anything below");
  });
});

describe.each(layouts)("AgentComposer (%s)", (layout) => {
  it("holds back the running timer until a run has lasted a moment", () => {
    const running = fakeChat({ run: { startedAt: Date.now() } as AgentChat["run"] });
    expect(composer(running, layout)).not.toContain("Working…");
  });

  it("shows the edit banner while editing", () => {
    expect(composer(fakeChat({ editingRowId: 3 }), layout)).toContain("Editing. Reruns from here");
  });

  it("lists queued messages under the input", () => {
    const chat = fakeChat({ queued: [{ key: "q1", queueId: 7, messageId: "m1", content: "next one" }] });
    expect(composer(chat, layout)).toContain("next one");
  });

  it("says the daemon is unreachable once the chat reports it", () => {
    const notice = "Can&#x27;t reach the daemon. Messages send when it&#x27;s back.";
    expect(composer(fakeChat({ error: "Failed to fetch" }), layout)).not.toContain(notice);
    expect(composer(fakeChat({ error: "Failed to fetch", disconnected: true }), layout)).toContain(notice);
  });

  it("addresses the agent by name", () => {
    expect(composer(fakeChat(), layout)).toContain('placeholder="Message Fonte Agent…"');
  });
});

describe("composerButton", () => {
  it("sends typed text when idle", () => {
    expect(composerButton({ running: false, input: "hi", sending: false, stopping: false })).toEqual({
      mode: "send", icon: "send", tooltip: "Send message", disabled: false, sendNow: false,
    });
  });

  it("is disabled with nothing typed and nothing running", () => {
    expect(composerButton({ running: false, input: "  ", sending: false, stopping: false }).disabled).toBe(true);
  });

  it("stops the run when nothing is typed", () => {
    expect(composerButton({ running: true, input: "", sending: false, stopping: false })).toEqual({
      mode: "stop", icon: "stop", tooltip: "Stop the agent", disabled: false, sendNow: false,
    });
    expect(composerButton({ running: true, input: "", sending: false, stopping: true }).disabled).toBe(true);
  });

  it("queues what is typed during a run and offers to stop and send it now", () => {
    expect(composerButton({ running: true, input: "also this", sending: false, stopping: false })).toEqual({
      mode: "send", icon: "send", tooltip: "Queue message", disabled: false, sendNow: true,
    });
  });

  it("holds while a send is in flight", () => {
    expect(composerButton({ running: false, input: "hi", sending: true, stopping: false })).toEqual({
      mode: "send", icon: "stop", tooltip: "Sending...", disabled: true, sendNow: false,
    });
  });
});

describe("isStopAndSend", () => {
  const key = (over: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({
    key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over,
  });

  it("is mod+Enter with something typed during a run", () => {
    expect(isStopAndSend(key({ metaKey: true }), { running: true, input: "now" })).toBe(true);
    expect(isStopAndSend(key({ ctrlKey: true }), { running: true, input: "now" })).toBe(true);
  });

  it("leaves plain Enter, an idle agent and an empty composer alone", () => {
    expect(isStopAndSend(key({}), { running: true, input: "now" })).toBe(false);
    expect(isStopAndSend(key({ metaKey: true }), { running: false, input: "now" })).toBe(false);
    expect(isStopAndSend(key({ metaKey: true }), { running: true, input: "  " })).toBe(false);
    expect(isStopAndSend(key({ metaKey: true, shiftKey: true }), { running: true, input: "now" })).toBe(false);
    expect(isStopAndSend(key({ key: "k", metaKey: true }), { running: true, input: "now" })).toBe(false);
  });
});
