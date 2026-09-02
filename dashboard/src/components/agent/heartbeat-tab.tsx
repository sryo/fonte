"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Heartbeat, FloppyDisk, Check, Lightning } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/feedback";
import { getAutomations, type AutomationRule } from "@/lib/api";
import { AddAutomationModal } from "@/components/home/add-automation-modal";
import { EditAutomationModal } from "@/components/home/edit-automation-modal";

const HEARTBEAT_NAME = "Heartbeat";

// A heartbeat is a cron automation whose prompt starts from heartbeat.md.
export function HeartbeatTab({
  agentId,
  content,
  filePath,
  loaded,
  onChange,
  onSave,
  saving,
  saved,
}: {
  agentId: string;
  content: string;
  filePath: string;
  loaded: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
}) {
  const [rule, setRule] = useState<AutomationRule | null>(null);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    getAutomations({ agent: agentId })
      .then((res) => {
        setRule(res.rules.find((r) => r.name === HEARTBEAT_NAME) ?? null);
        setRulesLoaded(true);
      })
      .catch(() => setRulesLoaded(true));
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-4 space-y-6 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Heartbeat className="h-4 w-4 text-primary" />
            Heartbeat
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4 p-3 bg-secondary/50 border">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {!rulesLoaded ? "Checking…" : rule ? `Runs ${rule.triggerDescription.charAt(0).toLowerCase()}${rule.triggerDescription.slice(1)}` : "No heartbeat rule yet"}
              </p>
              <p className="text-xs text-muted-foreground">
                {rule
                  ? rule.enabled
                    ? "The agent wakes on this schedule and runs the prompt below."
                    : "Paused. Resume it from the rule to start waking the agent again."
                  : "Create an automation that wakes the agent on a schedule with the prompt below."}
              </p>
            </div>
            {rule ? (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="shrink-0">
                <Lightning className="h-3.5 w-3.5" weight="fill" />
                Edit rule
              </Button>
            ) : (
              <Button size="sm" onClick={() => setCreating(true)} disabled={!rulesLoaded} className="shrink-0">
                <Lightning className="h-3.5 w-3.5" weight="fill" />
                Create heartbeat rule
              </Button>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                Heartbeat prompt
              </label>
              <span className="text-2xs text-muted-foreground">
                from{" "}
                <code className="bg-muted px-1 py-0.5 font-mono text-2xs">
                  {filePath || "heartbeat.md"}
                </code>
              </span>
            </div>
            <p className="text-2xs text-muted-foreground/70 mb-2">
              What the agent does each time the heartbeat fires. The rule copies this text when it is created; edit the rule to change a running heartbeat.
            </p>
            {!loaded ? (
              <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                <Spinner />
                <span className="text-sm">Loading...</span>
              </div>
            ) : (
              <Textarea
                value={content}
                onChange={(e) => onChange(e.target.value)}
                rows={10}
                className="text-sm font-mono"
                placeholder="Check your tasks, process pending work..."
              />
            )}
          </div>

          <div className="border-t pt-4 flex justify-end">
            <Button onClick={onSave} disabled={saving} size="sm" className="gap-2">
              {saving ? (
                <Spinner size="xs" />
              ) : saved ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <FloppyDisk className="h-3.5 w-3.5" />
              )}
              {saved ? "Saved" : "Save prompt"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <AddAutomationModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={load}
        agentId={agentId}
        title="Create heartbeat rule"
        initial={{
          name: HEARTBEAT_NAME,
          prompt: content.trim() || "Check your tasks and process pending work. Stay quiet if there is nothing to report.",
          trigger: { type: "cron", schedule: "*/30 9-18 * * 1-5" },
        }}
      />

      {editing && rule && (
        <EditAutomationModal
          key={rule.id}
          rule={rule}
          onClose={() => setEditing(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
