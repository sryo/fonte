"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { SmartBar } from "@/components/smart-bar";
import { ChatPanel } from "@/components/chat-panel";
import { StatusStrip } from "./status-strip";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [chatOpen, setChatOpen] = useState(false);

  const isSetup = pathname === "/setup";
  const hideSidebar = isSetup;

  return (
    <div className="flex h-screen overflow-hidden">
      {!hideSidebar && <Sidebar />}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!hideSidebar && <SmartBar onOpenChat={() => setChatOpen(true)} />}
        <main className="flex-1 overflow-y-auto">{children}</main>
        <StatusStrip />
      </div>
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
