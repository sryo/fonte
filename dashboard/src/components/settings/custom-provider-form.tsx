"use client";

import { useState } from "react";
import { saveCustomProvider } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/feedback";

const EMPTY_FORM = {
  id: "",
  name: "",
  harness: "claude" as "claude" | "codex",
  base_url: "",
  api_key: "",
  model: "",
};

/** The custom-provider form shared by the Providers and Agents sections. */
export function CustomProviderForm({
  onSaved,
  onCancel,
}: {
  /** Called with the new provider's id after a successful save. */
  onSaved: (id: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!form.id || !form.name || !form.base_url || !form.api_key) return;
    setSaving(true);
    setError(null);
    try {
      await saveCustomProvider(form.id, {
        name: form.name,
        harness: form.harness,
        base_url: form.base_url,
        api_key: form.api_key,
        model: form.model || undefined,
      });
      await onSaved(form.id);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError((err as Error).message);
    }
    setSaving(false);
  };

  return (
    <div className="border rounded-xl p-4 space-y-3 bg-muted/30">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Provider ID</Label>
          <Input
            value={form.id}
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            placeholder="my-provider"
            className="text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Display Name</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="My Provider"
            className="text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Harness</Label>
          <Select
            value={form.harness}
            onValueChange={(v) => setForm((f) => ({ ...f, harness: v as "claude" | "codex" }))}
          >
            <SelectTrigger className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude">Claude</SelectItem>
              <SelectItem value="codex">Codex</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Model (optional)</Label>
          <Input
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            placeholder="model-name"
            className="text-sm"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Base URL</Label>
        <Input
          value={form.base_url}
          onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
          placeholder="https://api.example.com"
          className="text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">API Key</Label>
        <Input
          type="password"
          value={form.api_key}
          onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
          placeholder="Enter API key"
          className="text-sm"
        />
      </div>
      {error && <p className="text-2xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <Button
          onClick={handleSave}
          disabled={saving || !form.id || !form.name || !form.base_url || !form.api_key}
        >
          {saving && <Spinner size="xs" />}
          Save
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setForm(EMPTY_FORM);
            onCancel();
          }}
          className="text-muted-foreground"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
