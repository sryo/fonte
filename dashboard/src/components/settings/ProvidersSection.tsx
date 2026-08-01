"use client";

import { useState, useEffect } from "react";
import {
  getCustomProviders,
  deleteCustomProvider,
  BUILTIN_PROVIDERS,
  type CustomProvider,
} from "@/lib/api";
import { Plug } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CustomProviderForm } from "./custom-provider-form";

export function ProvidersSection() {
  const [providers, setProviders] = useState<Record<string, CustomProvider>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchProviders = () =>
    getCustomProviders()
      .then((data) => {
        setProviders(data);
        setLoadError(null);
      })
      .catch((err) => setLoadError((err as Error).message))
      .finally(() => setLoading(false));

  useEffect(() => {
    void fetchProviders();
  }, []);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteCustomProvider(deleteTarget);
    await fetchProviders();
  };

  const entries = Object.entries(providers);

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Plug className="h-4 w-4 text-agent" weight="bold" />
          Providers
        </span>
      }
      count={entries.length}
      description="Built-in providers are always available; add custom ones for OpenAI-compatible endpoints"
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
                  onClick={() => setDeleteTarget(id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}

        {loadError && (
          <p className="text-sm text-destructive">
            Could not load providers: {loadError}{" "}
            <button type="button" onClick={() => void fetchProviders()} className="underline underline-offset-2">
              Retry
            </button>
          </p>
        )}

        {!loadError && !loading && entries.length === 0 && !showAdd && (
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
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete custom provider"
        message={<>Delete custom provider “{deleteTarget}”? This cannot be undone.</>}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </Section>
  );
}
