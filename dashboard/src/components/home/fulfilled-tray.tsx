"use client";

import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle, StackSimple, Trash } from "@phosphor-icons/react";
import { CardStack } from "@/components/home/card-stack";
import { CardAction } from "@/components/home/card-action";
import { stackDepthForCount } from "@/lib/stack-visual";

const ENTER_MS = 300;
const EXIT_MS = 250;
const STAGGER_MS = 45;
const MAX_STAGGERED = 8;

const staggerDelay = (i: number) => Math.min(i, MAX_STAGGERED) * STAGGER_MS;

/**
 * Fulfilled watch items collect in one messy pile at the end of the lane
 * instead of cluttering it; clicking fans them out as regular cards.
 */
export function FulfilledTray({
  count,
  posterUrl,
  onClear,
  children,
}: {
  count: number;
  posterUrl?: string;
  /** Poof-remove every fulfilled entry; cards are fanned out first so the poofs are visible. */
  onClear: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const items = Children.toArray(children);

  const toggle = () => {
    if (closing) return;
    if (!open) {
      setOpen(true);
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, EXIT_MS + staggerDelay(items.length - 1) + 30);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (closing) return;
    if (!confirm(`Remove ${count} fulfilled item${count === 1 ? "" : "s"} from the watchlist?`)) return;
    setOpen(true);
    onClear();
  };

  const showAsOpen = open && !closing;

  return (
    <>
      <CardStack depth={showAsOpen ? 0 : stackDepthForCount(count)} seed="fulfilled-tray">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={showAsOpen}
          aria-label={showAsOpen ? "Stack fulfilled items away" : `Show ${count} fulfilled item${count === 1 ? "" : "s"}`}
          onClick={toggle}
          onKeyDown={(e) => { if (e.key === "Enter") toggle(); }}
          className="w-44 h-full rounded-xl shadow-card bg-card overflow-hidden text-left hover:bg-accent/50 transition-colors group cursor-pointer relative"
        >
          <div className="aspect-[2/3] w-full bg-muted relative overflow-hidden">
            {!showAsOpen && posterUrl ? (
              <img src={posterUrl} alt="" className="w-full h-full object-cover opacity-40 saturate-50" loading="lazy" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-muted to-muted/50" />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-done">
              {showAsOpen ? (
                <StackSimple className="h-8 w-8" weight="fill" />
              ) : (
                <CheckCircle className="h-8 w-8" weight="fill" />
              )}
              <span className="text-2xl font-semibold tabular-nums">{showAsOpen ? "" : count}</span>
            </div>
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-end p-2">
              <CardAction icon={Trash} label={`Clear all fulfilled\nRemoves ${count} item${count === 1 ? "" : "s"} from the watchlist`} destructive onClick={clear} />
            </div>
          </div>
          <div className="p-3 space-y-1">
            <p className="text-sm font-medium leading-tight group-hover:text-foreground">
              {showAsOpen ? "Stack away" : "Fulfilled"}
            </p>
            <p className="text-2xs text-muted-foreground">
              {showAsOpen ? "Collapse the pile" : `${count} matched item${count === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
      </CardStack>
      {open &&
        items.map((child, i) => {
          const delay = closing ? staggerDelay(items.length - 1 - i) : staggerDelay(i);
          return (
            <div
              // The child's own key (entry id), so removing one card mid-fan
              // doesn't shift identities and replay enter animations.
              key={isValidElement(child) && child.key != null ? child.key : i}
              className={closing ? "animate-card-exit" : "animate-card-enter"}
              style={{
                animationDelay: `${delay}ms`,
                animationDuration: `${closing ? EXIT_MS : ENTER_MS}ms`,
                animationFillMode: "both",
              }}
            >
              {child}
            </div>
          );
        })}
    </>
  );
}
