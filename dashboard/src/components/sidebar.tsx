"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import Image from "next/image";
import {
  Zap, Download, Eye, SlidersVertical,
  Settings, Sun, Moon,
} from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

const NAV_ITEMS = [
  { href: "/automations", label: "Automations", icon: Zap, accent: "bg-automation text-automation-foreground" },
  { href: "/torrents", label: "Torrents", icon: Download, accent: "bg-torrent text-torrent-foreground" },
  { href: "/watchlist", label: "Watchlist", icon: Eye, accent: "bg-watchlist text-watchlist-foreground" },
  { href: "/control", label: "Control", icon: SlidersVertical, accent: "bg-secondary text-foreground" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <TooltipProvider>
      <aside className="flex h-screen w-14 flex-col items-center border-r bg-card py-3">
        {/* Logo */}
        <Link href="/" className="mb-4 flex items-center justify-center">
          <Image src="/icon.png" alt="AITorrent" width={28} height={28} className="h-7 w-7" />
        </Link>

        {/* Navigation */}
        <nav className="flex flex-col items-center gap-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon, accent }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                      active
                        ? accent
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom section */}
        <div className="flex flex-col items-center gap-1 border-t pt-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/settings"
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
                  pathname.startsWith("/settings")
                    ? "text-foreground bg-muted"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Settings className="h-[18px] w-[18px]" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              Settings
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {mounted && resolvedTheme === "dark" ? (
                  <Sun className="h-[18px] w-[18px]" />
                ) : (
                  <Moon className="h-[18px] w-[18px]" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
