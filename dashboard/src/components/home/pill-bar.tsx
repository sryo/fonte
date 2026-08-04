"use client";

import { Plus } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useSlidingIndicator } from "@/hooks/use-sliding-indicator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { CONFIGURABLE_PILLS, PILL_DEFS, type PillKey } from "@/lib/torrent-order";

export function PillBar({
  counts,
  active,
  onSelect,
  visible,
  onVisibleChange,
}: {
  counts: Record<PillKey, number>;
  active: PillKey;
  onSelect: (key: PillKey) => void;
  visible: PillKey[];
  onVisibleChange: (next: PillKey[]) => void;
}) {
  // All is permanent; Issues is always enabled; the rest obey the user's
  // visibility choices. Everything but All auto-hides at zero matches.
  const shown = PILL_DEFS.filter(({ key }) => {
    if (key === "all") return true;
    if (counts[key] === 0) return false;
    return key === "issues" || visible.includes(key);
  });

  const toggleVisible = (key: PillKey, on: boolean) => {
    onVisibleChange(on ? [...visible, key] : visible.filter((k) => k !== key));
  };

  // Pills auto-hide at zero matches and the Issues label embeds its count,
  // so both feed the layout key (repositions without animating).
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLSpanElement>(
    active,
    `${shown.map((p) => p.key).join(",")}:${counts.issues}`,
    true
  );

  return (
    <div
      ref={containerRef}
      className="group/pills relative flex items-center gap-2 flex-wrap"
      role="group"
      aria-label="Filter view"
    >
      <span
        ref={indicatorRef}
        aria-hidden
        className="absolute left-0 top-0 rounded-full bg-foreground opacity-0 transition-[transform,width,height] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
      />
      {shown.map(({ key, label }) => {
        const selected = active === key;
        const isIssues = key === "issues";
        return (
          <button
            key={key}
            data-indicator-key={key}
            aria-pressed={selected}
            aria-label={isIssues ? `Issues, ${counts.issues} items` : undefined}
            onClick={() => onSelect(key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "bg-foreground text-background group-data-[sliding]/pills:bg-transparent"
                : isIssues
                  ? "bg-warning/15 text-warning hover:bg-warning/25"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {/* Raised above the sliding thumb, which paints over button backgrounds. */}
            <span className="relative">{isIssues ? `${label} (${counts.issues})` : label}</span>
          </button>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Edit filters"
            title="Edit filters"
            className="rounded-full p-2 text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          >
            <Plus className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Show filters</DropdownMenuLabel>
          {PILL_DEFS.filter(({ key }) => CONFIGURABLE_PILLS.includes(key)).map(({ key, label }) => (
            <DropdownMenuCheckboxItem
              key={key}
              checked={visible.includes(key)}
              onCheckedChange={(checked) => toggleVisible(key, checked === true)}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="flex-1">{label}</span>
              <span className="ml-4 text-xs text-muted-foreground tabular-nums">{counts[key]}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span aria-live="polite" className="sr-only">
        Showing {counts[active] ?? 0} items — {PILL_DEFS.find((p) => p.key === active)?.label}
      </span>
    </div>
  );
}
