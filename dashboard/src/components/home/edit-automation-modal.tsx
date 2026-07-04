"use client";

import type { AutomationLog } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

export type EditAutomationForm = {
  name: string;
  triggerType: string;
  cron: string;
  prompt: string;
};

export function EditAutomationModal({
  form,
  setForm,
  logs,
  lastResponse,
  onClose,
  onSave,
}: {
  form: EditAutomationForm;
  setForm: (form: EditAutomationForm) => void;
  logs: AutomationLog[];
  lastResponse: { text: string; ts: number } | null;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-card rounded-xl shadow-lg border p-6 w-full max-w-md space-y-4 animate-card-enter" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold">Edit Automation</h3>
        <input
          placeholder="Rule name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
          autoFocus
        />
        <div>
          <label className="text-xs text-muted-foreground">Trigger</label>
          <select
            value={form.triggerType}
            onChange={(e) => setForm({ ...form, triggerType: e.target.value })}
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
        {form.triggerType === "schedule" && (
          <div>
            <label className="text-xs text-muted-foreground">Cron expression</label>
            <input
              placeholder="0 9 * * 1   (e.g. Mondays at 9am)"
              value={form.cron}
              onChange={(e) => setForm({ ...form, cron: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg border bg-background mt-1 font-mono"
            />
          </div>
        )}
        <div>
          <label className="text-xs text-muted-foreground">Prompt</label>
          <textarea
            placeholder="What should happen when this fires"
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            rows={5}
            className="w-full px-3 py-2 text-sm rounded-lg border bg-background mt-1 resize-y"
          />
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={onSave}
            disabled={!form.name.trim()}
            className="flex-1 px-4 py-2 text-sm bg-automation text-automation-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
          >
            Cancel
          </button>
        </div>

        {/* History — last response + trigger log */}
        <div className="pt-3 border-t space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Last response</label>
            {lastResponse ? (
              <div className="mt-1.5 rounded-md border bg-muted/30 px-3 py-2 max-h-40 overflow-y-auto">
                <p className="text-2xs text-muted-foreground">
                  {formatRelativeTime(lastResponse.ts)}
                </p>
                <p className="mt-1 text-xs whitespace-pre-wrap leading-relaxed">
                  {lastResponse.text}
                </p>
              </div>
            ) : (
              <p className="mt-1.5 text-xs text-muted-foreground italic">No responses yet.</p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Recent triggers ({logs.length})
            </label>
            {logs.length === 0 ? (
              <p className="mt-1.5 text-xs text-muted-foreground italic">Never triggered.</p>
            ) : (
              <ul className="mt-1.5 space-y-1 max-h-32 overflow-y-auto">
                {logs.slice(0, 10).map((log) => (
                  <li key={log.id} className="flex items-center justify-between gap-2 text-2xs">
                    <span className={log.conditionsMet ? "text-foreground" : "text-destructive"}>
                      {log.triggerEvent}{log.errorMessage ? ` — ${log.errorMessage}` : ""}
                    </span>
                    <span className="text-muted-foreground tabular-nums shrink-0">
                      {formatRelativeTime(log.executedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
