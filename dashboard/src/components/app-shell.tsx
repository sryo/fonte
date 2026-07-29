"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "./top-bar";
import { StatusStrip } from "./status-strip";
import { ChatPanel } from "./chat-panel";
import { HotkeysProvider, useHotkey } from "./hotkeys-provider";

// Needs to sit below HotkeysProvider, so it can't live in AppShell's own body.
function GlobalHotkeys() {
  const router = useRouter();

  useHotkey({
    id: "nav-home",
    keys: "g h",
    description: "Go to Home",
    handler: () => router.push("/"),
  });
  useHotkey({
    id: "nav-control",
    keys: "g c",
    description: "Go to Control",
    handler: () => router.push("/control"),
  });
  useHotkey({
    id: "nav-settings",
    keys: "g s",
    description: "Go to Settings",
    handler: () => router.push("/settings"),
  });

  return null;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <HotkeysProvider>
      <GlobalHotkeys />
      <div className="flex flex-col h-screen overflow-hidden">
        <TopBar onOpenChat={() => setChatOpen(true)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <StatusStrip />
        <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
      </div>
    </HotkeysProvider>
  );
}
