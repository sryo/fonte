"use client";

import { useState, type ElementType, type ReactNode } from "react";
import {
  CaretRight,
  FileText,
  Globe,
  MagnifyingGlass,
  Terminal,
  UsersThree,
  Wrench,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/feedback";
import { describeToolCall, type ToolCall } from "@/lib/agent-activity";

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
  return (
    <div
      className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
      title={phrase.detail}
    >
      {live ? <Spinner size="xs" /> : <Icon className="h-3.5 w-3.5 shrink-0" />}
      <span className={cn("truncate", live && "text-foreground")}>
        {live ? `${phrase.live}…` : phrase.done}
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
