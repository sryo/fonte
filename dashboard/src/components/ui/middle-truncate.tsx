import { cn } from "@/lib/utils";

/** Finder-style middle truncation: the head takes the ellipsis, the tail —
    extension included — always stays visible. CSS has no native middle
    ellipsis, so this is the two-span flex technique. */
export function MiddleTruncate({
  text,
  tailChars = 12,
  className,
}: {
  text: string;
  /** Characters pinned at the end (extension + a little context). */
  tailChars?: number;
  className?: string;
}) {
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
