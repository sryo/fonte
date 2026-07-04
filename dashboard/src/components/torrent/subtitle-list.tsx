"use client";

import { translateSubtitleApi, type SubtitleRecord } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

/** Per-language subtitle rows with status badges and translate action. */
export function SubtitleList({
  subtitles,
  onChanged,
}: {
  subtitles: SubtitleRecord[];
  onChanged: () => void;
}) {
  if (subtitles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No subtitles yet. Fetch to search by title &mdash; you don&apos;t have to wait for the download.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {subtitles.map((sub) => (
        <div
          key={sub.id}
          className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="w-6 font-mono text-xs font-bold uppercase">{sub.language}</span>
            <StatusBadge status={sub.status} size="xs" />
            {sub.isOriginal && (
              <span className="text-2xs text-muted-foreground">(original)</span>
            )}
          </div>
          {sub.isOriginal && sub.status === "downloaded" && (
            <Button
              size="xs"
              variant="ghost"
              onClick={async () => {
                const lang = prompt("Translate to language code (e.g. en, es, fr):");
                if (lang) {
                  await translateSubtitleApi(sub.id, lang);
                  onChanged();
                }
              }}
            >
              Translate
            </Button>
          )}
          {sub.errorMessage && (
            <span className="max-w-48 truncate text-2xs text-destructive">{sub.errorMessage}</span>
          )}
        </div>
      ))}
    </div>
  );
}
