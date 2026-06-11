"use client";

import { useState } from "react";
import { createAutomation } from "@/lib/api";

export function AddAutomationModal({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [autoForm, setAutoForm] = useState({
    name: "",
    triggerType: "torrent:completed",
    prompt: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-lg border p-6 w-full max-w-md space-y-4 animate-card-enter" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold">Create Automation</h3>
        <input
          placeholder="Rule name"
          value={autoForm.name}
          onChange={(e) => setAutoForm({ ...autoForm, name: e.target.value })}
          className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
          autoFocus
        />
        <div>
          <label className="text-xs text-muted-foreground">When this happens...</label>
          <select
            value={autoForm.triggerType}
            onChange={(e) => setAutoForm({ ...autoForm, triggerType: e.target.value })}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background mt-1"
          >
            <option value="torrent:completed">Torrent completes</option>
            <option value="torrent:added">Torrent added</option>
            <option value="torrent:error">Torrent error</option>
            <option value="torrent:stalled">Torrent stalled</option>
            <option value="watchlist:match">Watchlist match found</option>
            <option value="schedule">On a schedule</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Describe what should happen...</label>
          <textarea
            placeholder="e.g., Fetch subtitles in the original language, translate to Spanish, clean up the file name, and move to the right folder based on type."
            value={autoForm.prompt}
            onChange={(e) => setAutoForm({ ...autoForm, prompt: e.target.value })}
            rows={4}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background mt-1 resize-y"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            onClick={async () => {
              if (!autoForm.name.trim() || submitting) return;
              setSubmitting(true);
              setError(null);
              try {
                await createAutomation({
                  name: autoForm.name.trim(),
                  prompt: autoForm.prompt.trim(),
                  triggerType: autoForm.triggerType,
                });
                setAutoForm({ name: "", triggerType: "torrent:completed", prompt: "" });
                onClose();
                onCreated();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={!autoForm.name.trim() || submitting}
            className="flex-1 px-4 py-2 text-sm bg-automation text-automation-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
