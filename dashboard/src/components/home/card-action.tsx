"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function CardAction({ icon: Icon, label, onClick, destructive }: {
  icon: React.ElementType;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      title={label}
      className={cn(
        "h-8 w-8 rounded-md flex items-center justify-center backdrop-blur-sm transition-colors",
        destructive
          ? "bg-red-500/80 hover:bg-red-500 text-white"
          : "bg-white/20 hover:bg-white/30 text-white"
      )}
    >
      <Icon className="h-4 w-4" weight="bold" />
    </button>
  );
}
