"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Finder-style middle truncation: the head takes the ellipsis, the tail —
    extension included — always stays visible. Single-line is pure CSS (the
    two-span flex technique); multi-line needs measurement, since CSS has no
    middle ellipsis at all. */
export function MiddleTruncate({
  text,
  tailChars = 12,
  lines = 1,
  className,
}: {
  text: string;
  /** Characters pinned at the end (extension + a little context). */
  tailChars?: number;
  /** Rendered lines; values above 1 switch to the measured clamp. */
  lines?: number;
  className?: string;
}) {
  if (lines > 1) {
    return <MeasuredClamp text={text} tailChars={tailChars} lines={lines} className={className} />;
  }
  if (text.length <= tailChars + 4) {
    return (
      <span className={cn("truncate", className)} title={text}>
        {text}
      </span>
    );
  }
  const head = text.slice(0, -tailChars);
  const tail = text.slice(-tailChars);
  return (
    <span className={cn("flex min-w-0", className)} title={text}>
      <span className="truncate">{head}</span>
      <span className="shrink-0 whitespace-pre">{tail}</span>
    </span>
  );
}

/** Binary-searches the head length so head + … + tail fits in `lines`. The
    trimmed string is written straight to the DOM text node: React's vdom keeps
    holding `text`, so it never overwrites the trim unless `text` changes —
    which re-runs the effect anyway. No state, no re-renders. */
function MeasuredClamp({
  text,
  tailChars,
  lines,
  className,
}: {
  text: string;
  tailChars: number;
  lines: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
      if (!Number.isFinite(lineHeight)) return;
      const maxH = lineHeight * lines + 1;

      el.textContent = text;
      if (el.scrollHeight <= maxH) return;

      const tail = text.slice(-tailChars);
      const headFull = text.slice(0, -tailChars);
      let lo = 0;
      let hi = headFull.length;
      let best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        el.textContent = `${headFull.slice(0, mid)}…${tail}`;
        if (el.scrollHeight <= maxH) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      el.textContent = `${headFull.slice(0, best)}…${tail}`;
    };

    measure();

    // Re-fit when the column resizes or the real font swaps in.
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== lastWidth) {
        lastWidth = el.clientWidth;
        measure();
      }
    });
    ro.observe(el);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [text, tailChars, lines]);

  return (
    <span
      ref={ref}
      title={text}
      className={cn("block overflow-hidden", className)}
      style={{ maxHeight: `${lines}lh` }}
    >
      {text}
    </span>
  );
}
