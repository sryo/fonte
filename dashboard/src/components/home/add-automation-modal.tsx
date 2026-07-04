"use client";

import { useState } from "react";
import { createAutomation } from "@/lib/api";
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

// Shared with EditAutomationModal so the two pickers can't drift.
export const TRIGGER_TYPES: { value: string; label: string }[] = [
  { value: "torrent:completed", label: "Torrent completes" },
  { value: "torrent:added", label: "Torrent added" },
  { value: "torrent:error", label: "Torrent error" },
  { value: "torrent:stalled", label: "Torrent stalled" },
  { value: "watchlist:match", label: "Watchlist match found" },
  { value: "schedule", label: "On a schedule" },
];

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

  const handleCreate = async () => {
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
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Automation">
      <div className="space-y-4">
        <Input
          placeholder="Rule name"
          value={autoForm.name}
          onChange={(e) => setAutoForm({ ...autoForm, name: e.target.value })}
          autoFocus
        />
        <div className="space-y-1.5">
          <Label>When this happens...</Label>
          <Select
            value={autoForm.triggerType}
            onValueChange={(v) => setAutoForm({ ...autoForm, triggerType: v })}
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
        <div className="space-y-1.5">
          <Label>Describe what should happen...</Label>
          <Textarea
            placeholder="e.g., Fetch subtitles in the original language, translate to Spanish, clean up the file name, and move to the right folder based on type."
            value={autoForm.prompt}
            onChange={(e) => setAutoForm({ ...autoForm, prompt: e.target.value })}
            rows={4}
            className="resize-y"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button
            onClick={handleCreate}
            disabled={!autoForm.name.trim() || submitting}
            className="flex-1 bg-automation text-automation-foreground hover:bg-automation/90"
          >
            {submitting ? "Creating..." : "Create"}
          </Button>
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground">
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
