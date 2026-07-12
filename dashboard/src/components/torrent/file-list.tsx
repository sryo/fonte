"use client";

import { type TorrentFileRecord } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { ProgressBar, toPct } from "@/components/ui/progress-bar";

/** Per-file rows with wanted-toggle checkboxes and list progress bars. */
export function FileList({
  files,
  onToggle,
  downloading,
  stalled,
}: {
  files: TorrentFileRecord[];
  /** Flip a file's wanted state; receives the index and its current value. */
  onToggle: (idx: number, selected: boolean) => void;
  downloading: boolean;
  stalled: boolean;
}) {
  if (files.length === 0) {
    return <p className="text-sm text-muted-foreground">No file information available yet.</p>;
  }

  return (
    <div className="space-y-2">
      {files.map((file, idx) => {
        const filePct = toPct(file.progress);
        return (
          <div
            key={idx}
            className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-opacity ${file.selected ? "" : "opacity-50"}`}
          >
            <input
              type="checkbox"
              checked={file.selected}
              onChange={() => onToggle(idx, file.selected)}
              title={file.selected ? "Skip this file" : "Download this file"}
              className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
            />
            <div className="min-w-0 flex-1">
              <p className={`truncate font-mono text-xs ${file.selected ? "" : "line-through"}`}>
                {file.name}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <ProgressBar
                  value={file.progress}
                  variant="list"
                  shine={downloading && file.selected && file.progress < 1}
                  stalled={stalled}
                  done={file.progress >= 1}
                  className="flex-1"
                  label={`${file.name}: ${filePct}%`}
                />
                <span className="text-2xs tabular-nums text-muted-foreground w-9 text-right">
                  {filePct}%
                </span>
              </div>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatBytes(file.size)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
