"use client";

import { type ReactNode } from "react";
import { GhostInitial } from "@/components/ui/ghost-initial";

/**
 * The detail page's hero: a MediaCard rotated horizontal. Same poster ratio
 * bleeding to the card edge, same badge and title language, so the page reads
 * as the grid card seen up close.
 */
export function DetailHero({
  posterUrl,
  title,
  titleSuffix,
  badges,
  meta,
  children,
  details,
}: {
  posterUrl?: string;
  title: string;
  titleSuffix?: ReactNode;
  badges?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  details?: ReactNode;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl bg-card shadow-card sm:flex-row">
      <div className="w-full shrink-0 self-stretch bg-muted sm:w-36">
        {posterUrl ? (
          <img src={posterUrl} alt={title} className="aspect-video w-full object-cover sm:aspect-auto sm:h-full" />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-muted to-muted/50 sm:aspect-[2/3] sm:h-full">
            <GhostInitial text={title} className="text-5xl" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <h1 className="text-2xl font-black tracking-tight leading-tight line-clamp-2" title={title}>
          {title}
          {titleSuffix && <span className="ml-1.5 font-normal text-muted-foreground">{titleSuffix}</span>}
        </h1>
        {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
        {meta && <p className="text-xs text-muted-foreground tabular-nums">{meta}</p>}
        {children}
        {details && (
          <details className="mt-auto pt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
              Details
            </summary>
            <div className="pt-2">{details}</div>
          </details>
        )}
      </div>
    </div>
  );
}
