"use client";

import { useEffect, useState } from "react";
import { getAutomation, updateAutomation, type AutomationLog, type AutomationRule, type TriggerType } from "@/lib/api";
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

const formFromRule = (rule: AutomationRule) => ({
  name: rule.name,
  triggerType: rule.triggerType,
  cron: (rule.triggerConfig as { cron?: string })?.cron || "",
  prompt: rule.prompt,
});

// Self-contained like the Add modals: owns its form, fetches its own
// logs/last-response, and runs the save — the page just picks the rule.
export function EditAutomationModal({
  rule,
  onClose,
  onSaved,
}: {
  rule: AutomationRule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() => formFromRule(rule));
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [lastResponse, setLastResponse] = useState<{ text: string; ts: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(formFromRule(rule));
    setLogs([]);
    setLastResponse(null);
    getAutomation(rule.id)
      .then((res) => {
        setLogs(res.logs || []);
        setLastResponse(res.lastResponse);
      })
      .catch(() => {});
  }, [rule]);

  const onSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await updateAutomation(rule.id, {
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        triggerType: form.triggerType,
        triggerConfig: form.triggerType === "schedule" && form.cron.trim() ? { cron: form.cron.trim() } : {},
      });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

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
            onValueChange={(v) => setForm({ ...form, triggerType: v as TriggerType })}
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
        {error && <p className="text-2xs text-destructive">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button
            onClick={onSave}
            disabled={!form.name.trim() || saving}
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
