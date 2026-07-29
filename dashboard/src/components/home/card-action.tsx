"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Two-tier hover actions: the contextual verb is prominent, remove/delete recedes.
export function CardAction({ icon: Icon, label, onClick, destructive, variant = "secondary", hotkey }: {
  icon: React.ElementType;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
  variant?: "primary" | "secondary";
  /** Key that triggers this action while the card is focused, shown in the tooltip. */
  hotkey?: string;
}) {
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
                ? "h-12 w-12 rounded-full bg-white/25 hover:bg-white/40 text-white"
                : destructive
                  ? "h-7 w-7 rounded-md bg-black/40 text-white/75 hover:bg-red-500/90 hover:text-white"
                  : "h-7 w-7 rounded-md bg-white/20 hover:bg-white/30 text-white",
            )}
          >
            <Icon className={variant === "primary" ? "h-6 w-6" : "h-4 w-4"} weight="bold" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="flex items-center gap-1.5">
          <span className="whitespace-pre-line">{label}</span>
          {hotkey && (
            <Kbd className="bg-background/20 text-background">{hotkey}</Kbd>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
