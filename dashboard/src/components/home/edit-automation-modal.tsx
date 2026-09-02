"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAutomation,
  triggerAutomation,
  updateAutomation,
  subscribeToEvents,
  type AutomationRule,
  type AutomationRun,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Play } from "@phosphor-icons/react";
import {
  TriggerEditor,
  membersFromTrigger,
  membersToTrigger,
  type TriggerMemberForm,
} from "@/components/home/trigger-editor";
import { RunHistory } from "@/components/home/run-history";

// Callers key this by rule id, so switching rules mounts a fresh form.
export function EditAutomationModal({
  rule,
  onClose,
  onSaved,
}: {
  rule: AutomationRule;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(rule.name);
  const [prompt, setPrompt] = useState(rule.prompt);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [members, setMembers] = useState<TriggerMemberForm[]>(() => membersFromTrigger(rule.trigger));
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(() => {
    getAutomation(rule.id)
      .then((res) => setRuns(res.runs || []))
      .catch(() => {});
  }, [rule.id]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    return subscribeToEvents(
      (event) => { if (event.ruleId === rule.id) loadRuns(); },
      { eventTypes: ["automation:executed", "automation:finished"] },
    );
  }, [rule.id, loadRuns]);

  const trigger = membersToTrigger(members);
  const isRunning = runs.some((r) => r.status === "running");

  const onSave = async () => {
    if (!name.trim() || !prompt.trim() || !trigger) return;
    setSaving(true);
    setError(null);
    try {
      await updateAutomation(rule.id, { name: name.trim(), prompt: prompt.trim(), trigger, enabled });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const onRunNow = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await triggerAutomation(rule.id);
      setRuns(res.runs ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Edit automation" onSubmit={onSave}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Input
            placeholder="Rule name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="flex-1"
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enabled" />
            {enabled ? "Enabled" : "Paused"}
          </label>
        </div>
        <div className="space-y-1.5">
          <Label>When</Label>
          <TriggerEditor members={members} onChange={setMembers} />
        </div>
        <div className="space-y-1.5">
          <Label>What should happen</Label>
          <Textarea
            placeholder="What should happen when this fires"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            className="resize-y"
          />
        </div>
        {error && <p className="text-2xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={onRunNow}
            disabled={running || isRunning}
            className="text-muted-foreground"
          >
            <Play className="h-3.5 w-3.5" weight="fill" />
            {isRunning ? "Running…" : "Run now"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} className="text-muted-foreground">
            Cancel
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </Button>
          <Button
            type="submit"
            disabled={!name.trim() || !prompt.trim() || !trigger || saving}
            className="flex-1 bg-automation text-automation-foreground hover:bg-automation/90"
          >
            Save
            {!saving && <Kbd className="hidden sm:inline-flex bg-current/15 text-inherit">↵</Kbd>}
          </Button>
        </div>

        <div className="pt-3 border-t">
          <Label className="text-xs text-muted-foreground">Run history</Label>
          <RunHistory runs={runs} />
        </div>
      </div>
    </Modal>
  );
}
