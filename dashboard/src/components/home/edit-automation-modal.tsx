"use client";

import type { AutomationLog } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TRIGGER_TYPES } from "@/components/home/add-automation-modal";

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
    <Modal open onClose={onClose} title="Edit Automation">
      <div className="space-y-4">
        <Input
          placeholder="Rule name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          autoFocus
        />
        <div className="space-y-1.5">
          <Label>Trigger</Label>
          <Select
            value={form.triggerType}
            onValueChange={(v) => setForm({ ...form, triggerType: v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIGGER_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {form.triggerType === "schedule" && (
          <div className="space-y-1.5">
            <Label>Cron expression</Label>
            <Input
              placeholder="0 9 * * 1   (e.g. Mondays at 9am)"
              value={form.cron}
              onChange={(e) => setForm({ ...form, cron: e.target.value })}
              className="font-mono"
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Prompt</Label>
          <Textarea
            placeholder="What should happen when this fires"
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            rows={5}
            className="resize-y"
          />
        </div>
        <div className="flex gap-2 pt-1">
          <Button
            onClick={onSave}
            disabled={!form.name.trim()}
            className="flex-1 bg-automation text-automation-foreground hover:bg-automation/90"
          >
            Save
          </Button>
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground">
            Cancel
          </Button>
        </div>

        <div className="pt-3 border-t space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Last response</Label>
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
            <Label className="text-xs text-muted-foreground">
              Recent triggers ({logs.length})
            </Label>
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
    </Modal>
  );
}
