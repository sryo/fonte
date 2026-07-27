"use client";

import { useState } from "react";
import { translateSubtitleApi, type SubtitleRecord } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { StatusBadge } from "@/components/ui/status-badge";

/** Per-language subtitle rows with status badges and translate action. */
export function SubtitleList({
  subtitles,
  onChanged,
}: {
  subtitles: SubtitleRecord[];
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [translateFor, setTranslateFor] = useState<number | null>(null);
  const [lang, setLang] = useState("");
  const [translating, setTranslating] = useState(false);

  const submitTranslate = async () => {
    const code = lang.trim();
    if (translateFor === null || !code) return;
    setTranslating(true);
    try {
      setError(null);
      await translateSubtitleApi(translateFor, code);
      setTranslateFor(null);
      setLang("");
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTranslating(false);
    }
  };
  if (subtitles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No subtitles yet. Fetch to search by title &mdash; you don&apos;t have to wait for the download.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-2xs text-destructive">{error}</p>}
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
              onClick={() => { setTranslateFor(sub.id); setLang(""); }}
            >
              Translate
            </Button>
          )}
          {sub.errorMessage && (
            <span className="max-w-48 truncate text-2xs text-destructive">{sub.errorMessage}</span>
          )}
        </div>
      ))}

      <Modal open={translateFor !== null} onClose={() => setTranslateFor(null)} title="Translate subtitles">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="translate-lang">Target language code</Label>
            <Input
              id="translate-lang"
              autoFocus
              placeholder="e.g. en, es, fr"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitTranslate(); }}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" disabled={!lang.trim() || translating} onClick={submitTranslate}>
              {translating ? "Translating…" : "Translate"}
            </Button>
            <Button variant="ghost" onClick={() => setTranslateFor(null)} disabled={translating} className="text-muted-foreground">
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
