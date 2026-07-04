import { cn } from "@/lib/utils";
import { type HTMLAttributes } from "react";
import { TONE_BADGE, type Tone } from "@/lib/status";

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "outline" | "destructive";
  tone?: Tone;
}

export function Badge({ className, variant = "default", tone, ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
        tone
          ? TONE_BADGE[tone]
          : {
              "bg-primary text-primary-foreground": variant === "default",
              "bg-secondary text-secondary-foreground": variant === "secondary",
              "border text-foreground": variant === "outline",
              "bg-destructive text-destructive-foreground": variant === "destructive",
            },
        className
      )}
      {...props}
    />
  );
}
