"use client";

import { useState } from "react";
import { createAutomation, type AutomationTrigger } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import {
  TriggerEditor,
  defaultMember,
  membersFromTrigger,
  membersToTrigger,
  type TriggerMemberForm,
} from "@/components/home/trigger-editor";

export interface AutomationDraft {
  name?: string;
  prompt?: string;
  trigger?: AutomationTrigger;
}

export function AddAutomationModal({
  open,
  onClose,
  onCreated,
  agentId,
  initial,
  title = "Create automation",
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Rule owner; the daemon's default agent when omitted. */
  agentId?: string;
  /** Pre-filled fields, e.g. a schedule from the agent page. */
  initial?: AutomationDraft;
  title?: string;
}) {
  // Modal unmounts its content when closed, so the form mounts fresh from
  // `initial` on every open without any state syncing.
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <AutomationForm onClose={onClose} onCreated={onCreated} agentId={agentId} initial={initial} />
    </Modal>
  );
}

function AutomationForm({
  onClose,
  onCreated,
  agentId,
  initial,
}: {
  onClose: () => void;
  onCreated: () => void;
  agentId?: string;
  initial?: AutomationDraft;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [members, setMembers] = useState<TriggerMemberForm[]>(
    initial?.trigger ? membersFromTrigger(initial.trigger) : [defaultMember("event")],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trigger = membersToTrigger(members);
  const canSubmit = !!name.trim() && !!prompt.trim() && trigger !== null && !submitting;

  const handleCreate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit || !trigger) return;
    setSubmitting(true);
    setError(null);
    try {
      await createAutomation({ name: name.trim(), prompt: prompt.trim(), trigger, agent: agentId });
      onClose();
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleCreate}>
      <div className="space-y-4">
        <Input
          placeholder="Rule name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <div className="space-y-1.5">
          <Label>When</Label>
          <TriggerEditor members={members} onChange={setMembers} />
        </div>
        <div className="space-y-1.5">
          <Label>What should happen</Label>
          <Textarea
            placeholder="e.g. Fetch subtitles in the original language, translate to Spanish, clean up the file name, and move it to the right folder. Stay quiet if there is nothing to do."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            className="resize-y"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} className="text-muted-foreground">
            Cancel
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </Button>
          <Button
            type="submit"
            disabled={!canSubmit}
            className="flex-1 bg-automation text-automation-foreground hover:bg-automation/90"
          >
            {submitting ? "Creating..." : "Create"}
            {!submitting && <Kbd className="hidden sm:inline-flex bg-current/15 text-inherit">↵</Kbd>}
          </Button>
        </div>
      </div>
    </form>
  );
}
