"use client";

import { useState, useEffect } from "react";
import {
  getCustomProviders,
  saveCustomProvider,
  deleteCustomProvider,
  BUILTIN_PROVIDERS,
  type CustomProvider,
} from "@/lib/api";
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

// ── Providers Section (built-in + custom) ──────────────────────────────

export function ProvidersSection() {
  const [providers, setProviders] = useState<Record<string, CustomProvider>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    id: "",
    name: "",
    harness: "claude" as "claude" | "codex",
    base_url: "",
    api_key: "",
    model: "",
  });

  const fetchProviders = async () => {
    try {
      const data = await getCustomProviders();
      setProviders(data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const handleSave = async () => {
    if (!form.id || !form.name || !form.base_url || !form.api_key) return;
    setSaving(true);
    try {
      await saveCustomProvider(form.id, {
        name: form.name,
        harness: form.harness,
        base_url: form.base_url,
        api_key: form.api_key,
        model: form.model || undefined,
      });
      setForm({ id: "", name: "", harness: "claude", base_url: "", api_key: "", model: "" });
      setShowAdd(false);
      await fetchProviders();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete custom provider "${id}"? This cannot be undone.`)) return;
    try {
      await deleteCustomProvider(id);
      await fetchProviders();
    } catch {}
  };

  if (loading) return null;

  const entries = Object.entries(providers);

  return (
    <div className="rounded-xl bg-card shadow-card">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Providers</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Built-in providers are always available. Add custom ones for OpenAI-compatible endpoints.
            </p>
          </div>
          {!showAdd && (
            <Button size="sm" onClick={() => setShowAdd(true)} className="text-xs">
              Add Custom
            </Button>
          )}
        </div>

        {/* Built-in chips */}
        <div>
          <p className="text-2xs uppercase tracking-wider text-muted-foreground mb-1.5">Built-in</p>
          <div className="flex flex-wrap gap-1.5">
            {BUILTIN_PROVIDERS.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-muted text-foreground"
              >
                {p.name}
              </span>
            ))}
          </div>
        </div>

        {entries.length > 0 && (
          <p className="text-2xs uppercase tracking-wider text-muted-foreground">Custom</p>
        )}

        {/* Provider list */}
        {entries.length > 0 && (
          <div className="divide-y divide-border/50">
            {entries.map(([id, p]) => (
              <div key={id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">{p.name}</code>
                  <span className="text-2xs font-medium uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
                    {p.harness}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {p.base_url.replace(/https?:\/\//, "").slice(0, 40)}
                  </span>
                  {p.model && (
                    <span className="text-2xs font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
                      {p.model}
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleDelete(id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}

        {entries.length === 0 && !showAdd && (
          <p className="text-sm text-muted-foreground">No custom providers configured yet.</p>
        )}

        {/* Add provider form */}
        {showAdd && (
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
            <div className="flex items-center gap-2 pt-1">
              <Button
                onClick={handleSave}
                disabled={saving || !form.id || !form.name || !form.base_url || !form.api_key}
              >
                {saving && (
                  <div className="h-3 w-3 animate-spin border-2 border-primary-foreground border-t-transparent rounded-full" />
                )}
                Save
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowAdd(false);
                  setForm({ id: "", name: "", harness: "claude", base_url: "", api_key: "", model: "" });
                }}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
