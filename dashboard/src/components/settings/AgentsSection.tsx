"use client";

import { useState, useEffect } from "react";
import {
  getAgents,
  saveAgent,
  deleteAgent,
  resetAgent,
  BUILTIN_PROVIDERS,
  type AgentConfig,
  type Settings,
} from "@/lib/api";
import { agentFormError, cleanId, modelAfterProviderSwitch } from "@/lib/agent-form";
import { Robot } from "@phosphor-icons/react";
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
import { Section } from "@/components/ui/section";
import { Spinner } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CustomProviderForm } from "./custom-provider-form";

const EMPTY_FORM = { id: "", name: "", provider: "anthropic", model: "sonnet" };

export function AgentsSection({
  settings,
  onChanged,
}: {
  settings: Settings;
  onChanged: () => Promise<void>;
}) {
  const [agents, setAgents] = useState<Record<string, AgentConfig>>({});
  const providers = settings.custom_providers ?? {};
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const fetchAgents = () =>
    getAgents()
      .then((a) => {
        setAgents(a);
        setLoadError(null);
      })
      .catch((err) => setLoadError((err as Error).message));

  useEffect(() => {
    void fetchAgents();
  }, [settings.agents]);

  const handleSave = async () => {
    const invalid = agentFormError(form, Object.keys(agents));
    if (invalid) {
      setSaveError(invalid);
      return;
    }
    setSaving(true);
    try {
      await saveAgent(form.id, {
        name: form.name.trim(),
        provider: form.provider,
        model: form.model.trim(),
        working_directory: "",
      });
      setForm(EMPTY_FORM);
      setShowAdd(false);
      setSaveError(null);
      await onChanged();
    } catch (err) {
      setSaveError((err as Error).message);
    }
    setSaving(false);
  };

  const runOnRow = async (id: string, action: () => Promise<void>) => {
    setRowErrors((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
    try {
      await action();
    } catch (err) {
      setRowErrors((e) => ({ ...e, [id]: (err as Error).message || "Failed" }));
    }
  };

  const confirmDelete = async () => {
    const id = deleteTarget;
    if (!id) return;
    await runOnRow(id, async () => {
      await deleteAgent(id);
      await onChanged();
    });
  };

  const confirmReset = async () => {
    const id = resetTarget;
    if (!id) return;
    await runOnRow(id, async () => {
      await resetAgent(id);
      setResetSent(id);
      setTimeout(() => setResetSent(null), 2000);
    });
  };

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Robot className="size-5 text-muted-foreground" weight="bold" />
          Agents
        </span>
      }
      count={Object.keys(agents).length}
      description="Manage AI agents and their configurations"
      action={
        !showAdd ? (
          <Button size="sm" onClick={() => setShowAdd(true)} className="text-xs">
            Add agent
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {Object.keys(agents).length > 0 && (
          <div className="divide-y divide-border/50">
            {Object.entries(agents).map(([id, agent]) => (
              <div key={id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">{id}</code>
                  <span className="text-sm truncate">{agent.name}</span>
                  <span className="text-2xs font-medium uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
                    {agent.provider}
                  </span>
                  <span className="text-2xs font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
                    {agent.model}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {rowErrors[id] && <span className="text-xs text-destructive">{rowErrors[id]}</span>}
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setResetTarget(id)}
                    className="text-muted-foreground"
                  >
                    {resetSent === id ? "Reset sent" : "Reset"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setDeleteTarget(id)}
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {loadError && (
          <p className="text-sm text-destructive">
            Could not load agents: {loadError}{" "}
            <button type="button" onClick={() => void fetchAgents()} className="underline underline-offset-2">
              Retry
            </button>
          </p>
        )}

        {!loadError && Object.keys(agents).length === 0 && !showAdd && (
          <p className="text-sm text-muted-foreground">No agents configured yet.</p>
        )}

        {showAdd && (
          <div className="border rounded-xl p-4 space-y-3 bg-muted/30">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">ID</Label>
                <Input
                  value={form.id}
                  onChange={(e) => setForm((f) => ({ ...f, id: cleanId(e.target.value) }))}
                  placeholder="my-agent"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="My agent"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Provider</Label>
                <Select
                  value={form.provider}
                  onValueChange={(v) => {
                    if (v === "__add_custom__") {
                      setShowAddProvider(true);
                      return;
                    }
                    setForm((f) => ({
                      ...f,
                      provider: v,
                      model: modelAfterProviderSwitch(f.provider, v, f.model, providers),
                    }));
                  }}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUILTIN_PROVIDERS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                    {Object.entries(providers).map(([id, p]) => (
                      <SelectItem key={id} value={`custom:${id}`}>
                        {p.name} (custom)
                      </SelectItem>
                    ))}
                    <SelectItem value="__add_custom__">+ Add custom provider…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Model</Label>
                <Input
                  value={form.model}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  placeholder="sonnet"
                  className="text-sm"
                />
              </div>
            </div>

            {showAddProvider && (
              <CustomProviderForm
                existingIds={Object.keys(providers)}
                onSaved={async (id) => {
                  setShowAddProvider(false);
                  await onChanged();
                  setForm((f) => ({ ...f, provider: `custom:${id}` }));
                }}
                onCancel={() => setShowAddProvider(false)}
              />
            )}

            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => { setShowAdd(false); setShowAddProvider(false); setSaveError(null); setForm(EMPTY_FORM); }}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !form.id || !form.name || !form.model}
              >
                {saving && <Spinner size="xs" />}
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={resetTarget !== null}
        title="Reset agent"
        message={<>Reset “{resetTarget}”? Its conversation state is cleared and cannot be recovered.</>}
        confirmLabel="Reset"
        destructive
        onConfirm={confirmReset}
        onClose={() => setResetTarget(null)}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete agent"
        message={<>Delete agent “{deleteTarget}”? This cannot be undone.</>}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </Section>
  );
}
