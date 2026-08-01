"use client";

import { useState, useEffect } from "react";
import {
  getAgents,
  saveAgent,
  deleteAgent,
  sendMessage,
  getCustomProviders,
  BUILTIN_PROVIDERS,
  type AgentConfig,
  type CustomProvider,
} from "@/lib/api";
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

export function AgentsSection() {
  const [agents, setAgents] = useState<Record<string, AgentConfig>>({});
  const [providers, setProviders] = useState<Record<string, CustomProvider>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ id: "", name: "", provider: "anthropic", model: "sonnet" });
  const [saving, setSaving] = useState(false);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState<string | null>(null);

  const fetchAll = () =>
    Promise.all([getAgents(), getCustomProviders()])
      .then(([a, p]) => {
        setAgents(a);
        setProviders(p);
        setLoadError(null);
      })
      .catch((err) => setLoadError((err as Error).message));

  useEffect(() => {
    void fetchAll();
  }, []);

  const handleSave = async () => {
    if (!form.id || !form.name || !form.model) return;
    setSaving(true);
    try {
      await saveAgent(form.id, {
        name: form.name,
        provider: form.provider,
        model: form.model,
        working_directory: "",
      });
      setForm({ id: "", name: "", provider: "anthropic", model: "sonnet" });
      setShowAdd(false);
      setSaveError(null);
      await fetchAll();
    } catch (err) {
      setSaveError((err as Error).message);
    }
    setSaving(false);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteAgent(deleteTarget);
    await fetchAll();
  };

  const confirmReset = async () => {
    const id = resetTarget;
    if (!id) return;
    await sendMessage({ message: `@${id} /reset`, agent: id, channel: "web", sender: "Web" });
    setResetSent(id);
    setTimeout(() => setResetSent(null), 2000);
  };

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Robot className="h-4 w-4 text-agent" weight="bold" />
          Agents
        </span>
      }
      count={Object.keys(agents).length}
      description="Manage AI agents and their configurations"
      action={
        !showAdd ? (
          <Button size="sm" onClick={() => setShowAdd(true)} className="text-xs">
            Add Agent
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
            <button type="button" onClick={() => void fetchAll()} className="underline underline-offset-2">
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
                  onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                  placeholder="my-agent"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="My Agent"
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
                    setForm((f) => ({ ...f, provider: v }));
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
                onSaved={async (id) => {
                  setShowAddProvider(false);
                  await fetchAll();
                  setForm((f) => ({ ...f, provider: `custom:${id}` }));
                }}
                onCancel={() => setShowAddProvider(false)}
              />
            )}

            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
            <div className="flex items-center gap-2 pt-1">
              <Button
                onClick={handleSave}
                disabled={saving || !form.id || !form.name || !form.model}
              >
                {saving && <Spinner size="xs" />}
                Save
              </Button>
              <Button
                variant="ghost"
                onClick={() => { setShowAdd(false); setShowAddProvider(false); setForm({ id: "", name: "", provider: "anthropic", model: "sonnet" }); }}
                className="text-muted-foreground"
              >
                Cancel
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
