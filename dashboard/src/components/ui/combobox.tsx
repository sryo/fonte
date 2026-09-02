"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/feedback";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ComboboxOption<T = unknown> {
  value: string;
  hint?: string;
  /** Carried through to onSelect so callers keep the record behind the row. */
  data?: T;
}

/**
 * Free-text field with a suggestion list. Typed text always wins — suggestions
 * are a shortcut, never a constraint.
 *
 * The list rides Radix's dismissable-layer stack, so inside a modal Escape
 * closes the list first and the dialog only once the list is gone. Enter is
 * swallowed while a row is highlighted so it picks instead of submitting.
 */
export function Combobox<T,>({
  value,
  onValueChange,
  options,
  onSelect,
  filter = true,
  loading = false,
  className,
  ...props
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: ComboboxOption<T>[];
  onSelect?: (option: ComboboxOption<T>) => void;
  filter?: boolean;
  loading?: boolean;
} & Omit<React.ComponentProps<"input">, "value" | "onChange" | "onSelect">) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();

  const shown = React.useMemo(() => {
    if (!filter) return options;
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.value.toLowerCase().includes(q));
  }, [options, value, filter]);

  // Clamped rather than reset by an effect: the list can shrink under a
  // highlight at any time, and a stale index must never survive into Enter.
  const activeIdx = active < shown.length ? active : -1;
  const visible = open && (shown.length > 0 || loading);

  const choose = (option: ComboboxOption<T>) => {
    onValueChange(option.value);
    onSelect?.(option);
    setOpen(false);
    setActive(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!shown.length) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return (next + shown.length) % shown.length;
      });
      return;
    }
    if (e.key === "Enter" && visible && activeIdx >= 0) {
      e.preventDefault();
      choose(shown[activeIdx]);
      return;
    }
    if (e.key === "Tab") setOpen(false);
  };

  return (
    <Popover open={visible} onOpenChange={(o) => !o && setOpen(false)}>
      <PopoverAnchor asChild>
        <Input
          {...props}
          ref={inputRef}
          role="combobox"
          aria-expanded={visible}
          aria-controls={visible ? listId : undefined}
          aria-activedescendant={activeIdx >= 0 ? `${listId}-${activeIdx}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          className={className}
          value={value}
          onChange={(e) => {
            onValueChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </PopoverAnchor>
      <PopoverContent
        id={listId}
        role="listbox"
        align="start"
        sideOffset={4}
        // Focus stays in the input the whole time; the popover is a list the
        // input drives, not a place to tab into.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (e.target === inputRef.current) e.preventDefault();
        }}
        className="w-(--radix-popover-trigger-width) max-h-72 overflow-y-auto rounded-xl p-1"
      >
        {shown.map((o, i) => (
          <div
            key={o.value}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === activeIdx}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(o);
            }}
            onMouseEnter={() => setActive(i)}
            className={cn(
              "flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 cursor-pointer",
              i === activeIdx && "bg-accent",
            )}
          >
            <span className="text-sm font-bold truncate">{o.value}</span>
            {o.hint && <span className="text-xs text-muted-foreground shrink-0">{o.hint}</span>}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
            <Spinner size="xs" />
            Searching
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
