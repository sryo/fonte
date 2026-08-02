"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "./top-bar";
import { StatusStrip } from "./status-strip";
import { ChatPanel } from "./chat-panel";
import { HotkeysProvider, useHotkey } from "./hotkeys-provider";
import {
  ContentWidthHandle,
  CONTENT_W_DEFAULT,
  CONTENT_W_MAX,
  CONTENT_W_MIN,
} from "./content-width-handle";
import { usePersistedState } from "@/hooks/use-persisted-state";

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
  const [contentWidth, setContentWidth] = usePersistedState<number>(
    "fonte.content-max-width",
    CONTENT_W_DEFAULT,
    (v): v is number => typeof v === "number" && v >= CONTENT_W_MIN && v <= CONTENT_W_MAX
  );
  const mainRef = useRef<HTMLElement>(null);

  return (
    <HotkeysProvider>
      <GlobalHotkeys />
      <div
        className="flex flex-col h-screen overflow-hidden"
        data-content-root=""
        style={{ "--content-max-w": `${contentWidth}px` } as CSSProperties}
      >
        <TopBar onOpenChat={() => setChatOpen(true)} />
        <div className="relative flex-1 min-h-0">
          <main
            ref={mainRef}
            className="h-full overflow-y-auto [scrollbar-gutter:stable_both-edges]"
          >
            {children}
          </main>
          <ContentWidthHandle
            side="left"
            width={contentWidth}
            setWidth={setContentWidth}
            scrollRef={mainRef}
          />
          <ContentWidthHandle
            side="right"
            width={contentWidth}
            setWidth={setContentWidth}
            scrollRef={mainRef}
          />
        </div>
        <StatusStrip />
        <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
      </div>
    </HotkeysProvider>
  );
}
