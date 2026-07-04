"use client";

import React from "react";
import { cn } from "@/lib/utils";

// Two-tier hover actions: the contextual verb (pause, search, run…) renders
// as a big centered circle; remove/delete recedes into a small corner button
// whose red only materializes on direct hover.
export function CardAction({ icon: Icon, label, onClick, destructive, variant = "secondary" }: {
  icon: React.ElementType;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      title={label}
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
  );
}
