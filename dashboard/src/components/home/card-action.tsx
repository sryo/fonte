"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { IconSwap } from "@/components/ui/icon-swap";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Two-tier hover actions: the contextual verb is prominent, remove/delete recedes.
export function CardAction({ icon: Icon, icons, label, onClick, destructive, variant = "secondary", kbd }: {
  icon?: React.ElementType;
  /** Cross-dissolving icon set for actions whose verb toggles (pause/play). */
  icons?: { active: string; map: Record<string, React.ElementType> };
  label: string;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
  variant?: "primary" | "secondary";
  kbd?: string;
}) {
  const iconClass =
    variant === "primary"
      ? "h-6 w-6 group-data-[cards=compact]/cards:h-4 group-data-[cards=compact]/cards:w-4"
      : "h-4 w-4";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClick(e); }}
            aria-label={label}
            className={cn(
              "flex items-center justify-center backdrop-blur-sm transition-colors",
              variant === "primary"
                ? "h-12 w-12 rounded-full bg-white/25 hover:bg-white/40 text-white group-data-[cards=compact]/cards:h-9 group-data-[cards=compact]/cards:w-9"
                : destructive
                  ? "h-7 w-7 rounded-md bg-black/40 text-white/75 hover:bg-red-500/90 hover:text-white group-data-[cards=compact]/cards:hidden"
                  : "h-7 w-7 rounded-md bg-white/20 hover:bg-white/30 text-white group-data-[cards=compact]/cards:hidden",
            )}
          >
            {icons ? (
              <IconSwap
                active={icons.active}
                icons={Object.fromEntries(
                  Object.entries(icons.map).map(([key, I]) => [
                    key,
                    <I key={key} className={iconClass} weight="bold" />,
                  ])
                )}
              />
            ) : (
              Icon && <Icon className={iconClass} weight="bold" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-1.5">
          <span className="whitespace-pre-line">{label}</span>
          {kbd && <Kbd>{kbd}</Kbd>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
