"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";

export type SaveStatus =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved" }
  | { state: "error"; message: string };

const IDLE: SaveStatus = { state: "idle" };

export function FieldStatus({ status }: { status: SaveStatus }) {
  if (status.state === "idle") return null;
  if (status.state === "saving") {
    return <span className="text-xs text-muted-foreground">Saving…</span>;
  }
  if (status.state === "saved") {
    return (
      <span className="text-xs text-done flex items-center gap-1 animate-overlay-in">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        Saved
      </span>
    );
  }
  return <span className="text-xs text-destructive">{status.message}</span>;
}

/** Per-field auto-save over one settings section. Commits render
    optimistically, serialize through a queue so sibling commits can't
    clobber each other, and roll back to the committed value on failure. */
export function useAutoSaveSection<T extends object>(
  committed: T,
  save: (patch: Partial<T>) => Promise<void>
) {
  const [pending, setPending] = useState<Partial<T>>({});
  const [statuses, setStatuses] = useState<Record<string, SaveStatus>>({});
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  useEffect(
    () => () => {
      Object.values(timersRef.current).forEach(clearTimeout);
    },
    []
  );

  const setStatus = useCallback((key: string, status: SaveStatus) => {
    setStatuses((s) => ({ ...s, [key]: status }));
  }, []);

  const commit = useCallback(
    <K extends keyof T & string>(key: K, value: T[K]) => {
      setPending((p) => ({ ...p, [key]: value }));
      clearTimeout(timersRef.current[key]);
      setStatus(key, { state: "saving" });
      queueRef.current = queueRef.current.then(async () => {
        // A newer commit for the same key owns the pending entry now.
        const settle = () =>
          setPending((p) => {
            if (!Object.is(p[key], value)) return p;
            const next = { ...p };
            delete next[key];
            return next;
          });
        try {
          await saveRef.current({ [key]: value } as unknown as Partial<T>);
          settle();
          setStatus(key, { state: "saved" });
          timersRef.current[key] = setTimeout(() => setStatus(key, IDLE), 2000);
        } catch (err) {
          settle();
          setStatus(key, {
            state: "error",
            message: (err as Error).message || "Save failed",
          });
        }
      });
    },
    [setStatus]
  );

  const value = <K extends keyof T & string>(key: K): T[K] =>
    key in pending ? (pending[key] as T[K]) : committed[key];

  const statusFor = (key: keyof T & string): SaveStatus => statuses[key] ?? IDLE;

  return { value, commit, statusFor };
}

/** Local text draft that commits on blur (and Enter via blur), only when
    changed; adopts the committed value on rollback or refetch. */
export function useDraft(committed: string, onCommit: (draft: string) => void) {
  const [draft, setDraft] = useState(committed);
  const [prev, setPrev] = useState(committed);
  if (prev !== committed) {
    setPrev(committed);
    setDraft(committed);
  }
  return {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onBlur: () => {
      if (draft !== committed) onCommit(draft);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") e.currentTarget.blur();
    },
  };
}

export function SettingRow({
  label,
  description,
  status,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  status?: SaveStatus;
  children: React.ReactNode;
}) {
  const id = useId();
  // Single control children get the generated id for label association;
  // multi-element children render as-is.
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
      <div className="shrink-0 flex items-center gap-2">
        {status && <FieldStatus status={status} />}
        {child}
      </div>
    </div>
  );
}

/** Masked input with a reveal toggle, for API keys and tokens. */
export function SecretInput({
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  id,
  className,
}: {
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
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
        onBlur={onBlur}
        onKeyDown={onKeyDown}
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
    typing, and commits on blur/Enter — valid values clamped to min,
    invalid drafts snap back to the committed value. */
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
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = step && step < 1 ? parseFloat(draft) : parseInt(draft, 10);
        if (Number.isNaN(n)) {
          setDraft(String(value));
          return;
        }
        const clamped = min !== undefined ? Math.max(min, n) : n;
        setDraft(String(clamped));
        if (clamped !== value) onCommit(clamped);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/** Right-aligned footer for the sections that keep an explicit save
    (free-form text like SOUL.md and the raw JSON editor). */
export function SaveFooter({
  onClick,
  saving,
  saved,
  error,
  disabled = false,
  label = "Save",
  accentClass = "bg-primary text-primary-foreground hover:bg-primary/90",
}: {
  onClick: () => void;
  saving: boolean;
  saved: boolean;
  error?: string | null;
  disabled?: boolean;
  label?: string;
  accentClass?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-1">
      {error ? (
        <FieldStatus status={{ state: "error", message: error }} />
      ) : saved ? (
        <FieldStatus status={{ state: "saved" }} />
      ) : null}
      <Button size="sm" onClick={onClick} disabled={saving || disabled} className={accentClass}>
        {saving && <Spinner size="xs" />}
        {label}
      </Button>
    </div>
  );
}
