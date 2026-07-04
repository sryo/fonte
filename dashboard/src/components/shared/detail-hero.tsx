"use client";

import { type ReactNode } from "react";
import { FilmStrip } from "@phosphor-icons/react";

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
    <div className="flex overflow-hidden rounded-xl bg-card shadow-card">
      <div className="w-36 shrink-0 self-stretch bg-muted">
        {posterUrl ? (
          <img src={posterUrl} alt={title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex aspect-[2/3] h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/50">
            <FilmStrip className="size-10 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <h1 className="text-lg font-semibold leading-tight line-clamp-2">
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
