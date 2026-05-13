"use client";

import { useState } from "react";
import { TopBar } from "./top-bar";
import { StatusStrip } from "./status-strip";
import { ChatPanel } from "./chat-panel";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TopBar onOpenChat={() => setChatOpen(true)} />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <StatusStrip />
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
