"use client";

import { Plus } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
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

  return (
    <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter view">
      {shown.map(({ key, label }) => {
        const selected = active === key;
        const isIssues = key === "issues";
        return (
          <button
            key={key}
            aria-pressed={selected}
            aria-label={isIssues ? `Issues, ${counts.issues} items` : undefined}
            onClick={() => onSelect(key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "bg-foreground text-background"
                : isIssues
                  ? "bg-warning/15 text-warning hover:bg-warning/25"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {isIssues ? `${label} (${counts.issues})` : label}
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
