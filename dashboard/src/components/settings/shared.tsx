"use client";

import { cloneElement, isValidElement, useId, useState } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

export function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  // Wire the label to a single control child so clicking it focuses the
  // field and screen readers announce the pair. Multi-element children
  // (button groups etc.) render as-is.
  const child =
    isValidElement<{ id?: string }>(children) && children.props.id === undefined
      ? cloneElement(children, { id })
      : children;
  const labeled = child !== children;
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <Label htmlFor={labeled ? id : undefined} className="text-sm font-medium">
          {label}
        </Label>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="shrink-0">{child}</div>
    </div>
  );
}

/** Masked input with a reveal toggle, for API keys and tokens. */
export function SecretInput({
  value,
  onChange,
  placeholder,
  id,
  className,
}: {
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  id?: string;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete="off"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="pr-8 text-sm"
      />
      <button
        type="button"
        aria-label={show ? "Hide value" : "Show value"}
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeSlash className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/** Numeric input holding a local string draft: it can be cleared while
    typing, commits only valid values (clamped to min), and snaps back to
    the committed value on blur. */
export function NumberInput({
  value,
  onCommit,
  min,
  step,
  id,
  className,
  placeholder,
}: {
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  step?: number;
  id?: string;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(String(value));
  }
  return (
    <Input
      id={id}
      type="number"
      value={draft}
      min={min}
      step={step}
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = step && step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
        if (!Number.isNaN(n)) onCommit(min !== undefined ? Math.max(min, n) : n);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}

export function SectionSaveButton({
  onClick,
  saving,
  saved,
  disabled = false,
  error,
  accentClass = "bg-primary text-primary-foreground hover:bg-primary/90",
}: {
  onClick: () => void;
  saving: boolean;
  saved: boolean;
  /** Pristine cards disable Save — it doubles as the unsaved-changes signal. */
  disabled?: boolean;
  /** Save failure for THIS section, rendered next to the button that caused it. */
  error?: string | null;
  accentClass?: string;
}) {
  return (
    <div className="flex items-center gap-3 pt-2 mt-2 border-t border-border/50">
      <Button onClick={onClick} disabled={saving || disabled} className={accentClass}>
        {saving && <Spinner size="xs" />}
        Save
      </Button>
      {saved && (
        <span className="text-sm text-done flex items-center gap-1">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Saved
        </span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
