"use client";

import { useState, type ElementType, type ReactNode } from "react";
import Link from "next/link";
import {
  CaretRight,
  FileText,
  Globe,
  MagnifyingGlass,
  Terminal,
  UsersThree,
  Wrench,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/feedback";
import { describeToolCall, type ToolCall, type TranscriptEvent } from "@/lib/agent-activity";

const TOOL_ICONS: Record<string, ElementType> = {
  WebFetch: Globe,
  WebSearch: MagnifyingGlass,
  Grep: MagnifyingGlass,
  Glob: MagnifyingGlass,
  Bash: Terminal,
  Read: FileText,
  Write: FileText,
  Edit: FileText,
  Task: UsersThree,
  Agent: UsersThree,
};

function Row({ call, live }: { call: ToolCall; live: boolean }) {
  const phrase = describeToolCall(call);
  const Icon = TOOL_ICONS[call.name] ?? Wrench;
  const failed = call.status === "failed";
  const pending = live && call.status === undefined;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 text-xs",
        failed ? "text-destructive" : "text-muted-foreground"
      )}
      title={phrase.detail}
    >
      {pending ? (
        <Spinner size="xs" />
      ) : failed ? (
        <XCircle weight="fill" className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className={cn("truncate", pending && "text-foreground")}>
        {pending ? `${phrase.live}…` : failed ? phrase.failed : phrase.done}
      </span>
    </div>
  );
}

/**
 * A run of consecutive tool calls. Live: the last few steps, spinner on the
 * current one, older ones folded into a count. Settled: one collapsed line
 * that expands to the full timeline.
 */
export function ToolActivity({ calls, live }: { calls: ToolCall[]; live: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const failures = calls.filter((c) => c.status === "failed").length;

  if (live) {
    const visible = calls.slice(-3);
    const hidden = calls.length - visible.length;
    return (
      <div className="max-w-[85%] space-y-1.5 rounded-xl rounded-bl-sm border bg-card px-3 py-2">
        {hidden > 0 && <p className="text-2xs text-muted-foreground">+{hidden} earlier</p>}
        {visible.map((call, i) => (
          <Row key={call.key} call={call} live={i === visible.length - 1} />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-[85%]">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <CaretRight
          weight="bold"
          className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")}
        />
        Used {calls.length} tool{calls.length === 1 ? "" : "s"}
        {failures > 0 && (
          <span className="text-destructive">
            · {failures} failed
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1.5 rounded-xl border bg-card px-3 py-2">
          {calls.map((call) => (
            <Row key={call.key} call={call} live={false} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SystemNote({ children }: { children: ReactNode }) {
  return <p className="text-center text-2xs text-muted-foreground">{children}</p>;
}

function RuleName({ event }: { event: TranscriptEvent }) {
  const name = event.ruleName ?? "rule";
  if (!event.ruleId) return <strong className="font-semibold text-foreground/80">{name}</strong>;
  return (
    <Link
      href={`/?automation=${encodeURIComponent(event.ruleId)}`}
      className="font-semibold text-foreground/80 underline-offset-2 hover:underline"
    >
      {name}
    </Link>
  );
}

/** Transcript note for a `kind: 'event'` row, in the same voice as SystemNote. */
export function EventNote({ event }: { event: TranscriptEvent }) {
  const tail = event.summary ? ` · ${event.summary}` : "";
  let body: ReactNode;
  if (event.event === "automation-fired") {
    body = event.ruleName || event.ruleId ? (
      <>Automation <RuleName event={event} /> fired{tail}</>
    ) : (
      <>An automation fired{tail}</>
    );
  } else if (event.event === "automation-paused") {
    body = event.ruleName || event.ruleId ? (
      <>Paused automation <RuleName event={event} /> to answer you</>
    ) : (
      event.summary || "Paused an automation to answer you"
    );
  } else {
    body = event.summary || event.event;
  }
  return <SystemNote>{body}</SystemNote>;
}

/**
 * Delivery state under an optimistic user bubble. Failure keeps its controls
 * on the row: no toast.
 */
export function SendStatus({
  phase,
  error,
  onRetry,
  onDiscard,
  className,
}: {
  phase: "pending" | "failed";
  error?: string;
  onRetry: () => void;
  onDiscard: () => void;
  className?: string;
}) {
  if (phase === "pending") {
    return (
      <p className={cn("flex items-center gap-1.5 text-2xs text-muted-foreground", className)}>
        <Spinner size="xs" className="size-2.5 border" />
        Sending
      </p>
    );
  }
  return (
    <p className={cn("flex items-center gap-2 text-2xs", className)} title={error}>
      <span className="text-destructive">Couldn&apos;t send</span>
      <button
        type="button"
        onClick={onRetry}
        className="rounded px-1 py-0.5 font-semibold text-foreground hover:bg-muted transition-colors"
      >
        Retry
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="rounded px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        Discard
      </button>
    </p>
  );
}

/** A message accepted by the queue that the agent hasn't picked up yet. */
export function QueuedRow({
  content,
  onCancel,
  cancelling,
}: {
  content: string;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="shrink-0 font-semibold text-muted-foreground">Queued</span>
      <span className="min-w-0 flex-1 truncate text-foreground/80" title={content}>
        {content}
      </span>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          aria-label="Cancel queued message"
          title="Cancel"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
        >
          {cancelling ? <Spinner size="xs" className="size-3" /> : <X className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}
