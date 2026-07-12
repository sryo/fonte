"use client";

import { useState, useEffect } from "react";
import {
  getCustomProviders,
  deleteCustomProvider,
  BUILTIN_PROVIDERS,
  type CustomProvider,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { CustomProviderForm } from "./custom-provider-form";

// ── Providers Section (built-in + custom) ──────────────────────────────

export function ProvidersSection() {
  const [providers, setProviders] = useState<Record<string, CustomProvider>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

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
    <Section
      title="Providers"
      description="Built-in providers are always available. Add custom ones for OpenAI-compatible endpoints."
      action={
        !showAdd ? (
          <Button size="sm" onClick={() => setShowAdd(true)} className="text-xs">
            Add Custom
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
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

        {showAdd && (
          <CustomProviderForm
            onSaved={async () => {
              setShowAdd(false);
              await fetchProviders();
            }}
            onCancel={() => setShowAdd(false)}
          />
        )}
      </div>
    </Section>
  );
}
