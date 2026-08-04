"use client";

import React, { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

export function ContentRow({
  title,
  count,
  icon: Icon,
  children,
  emptyContent,
  isEmpty,
  action,
  collapsed = false,
  onToggleCollapse,
  collapsedContent,
  transitionName,
}: {
  title: string;
  count: number;
  icon: React.ElementType;
  children: React.ReactNode;
  emptyContent: React.ReactNode;
  isEmpty: boolean;
  action?: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  collapsedContent?: React.ReactNode;
  transitionName?: string;
}) {
  const bodyId = useId();
  const [hasToggled, setHasToggled] = useState(false);
  // The view-transition overlay steals :hover while the morph plays, so the
  // caret's hover-only reveal would snapshot as hidden and cross-fade away.
  // Pinning it visible through the morph lets the rotation read.
  const [pinCaret, setPinCaret] = useState(false);
  const pinTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(pinTimer.current), []);
  // The morph handles the swap when view transitions exist; the enter
  // animation is the fallback, and only after a user toggle — the section
  // root below already animates the initial mount.
  const swapAnim =
    hasToggled && typeof document !== "undefined" && !("startViewTransition" in document);

  const heading = (
    <>
      <Icon className="h-5 w-5 text-muted-foreground" weight="bold" />
      {title}
      {count > 0 && <span className="text-sm font-normal text-muted-foreground">({count})</span>}
    </>
  );

  return (
    <section
      className="space-y-3 animate-card-enter"
      style={transitionName ? ({ viewTransitionName: transitionName } as CSSProperties) : undefined}
    >
      <div className="flex items-center justify-between">
        {onToggleCollapse ? (
          <h2 className="text-lg font-bold">
            <button
              type="button"
              onClick={() => {
                setHasToggled(true);
                setPinCaret(true);
                window.clearTimeout(pinTimer.current);
                pinTimer.current = window.setTimeout(() => setPinCaret(false), 400);
                onToggleCollapse();
              }}
              aria-expanded={!collapsed}
              aria-controls={bodyId}
              className="group/heading flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {heading}
              <CaretRight
                weight="bold"
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground transition-[transform,opacity]",
                  !collapsed && "rotate-90",
                  !collapsed && !pinCaret &&
                    "opacity-0 group-hover/heading:opacity-100 group-focus-visible/heading:opacity-100"
                )}
                // Own view-transition group: inside the section's snapshot the
                // rotation would render as a cross-fade instead of a turn.
                style={
                  transitionName
                    ? ({ viewTransitionName: `${transitionName}-caret` } as CSSProperties)
                    : undefined
                }
              />
            </button>
          </h2>
        ) : (
          <h2 className="text-lg font-bold flex items-center gap-2">{heading}</h2>
        )}
        {action}
      </div>
      {collapsed && collapsedContent !== undefined ? (
        <div
          key="collapsed"
          id={bodyId}
          className={cn("flex flex-wrap gap-2", swapAnim && "animate-card-enter")}
        >
          {collapsedContent}
        </div>
      ) : (
        <div
          key="expanded"
          id={bodyId}
          className={cn("flex flex-wrap gap-3", swapAnim && "animate-card-enter")}
        >
          {isEmpty ? emptyContent : children}
        </div>
      )}
    </section>
  );
}
