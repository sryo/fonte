"use client";

import { useState, useEffect } from "react";
import {
  getCustomProviders,
  deleteCustomProvider,
  BUILTIN_PROVIDERS,
  type CustomProvider,
  type Settings,
} from "@/lib/api";
import { Plug } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CustomProviderForm } from "./custom-provider-form";
import { SettingRow, SecretInput, useAutoSaveSection, useDraft } from "./shared";

type Models = NonNullable<Settings["models"]>;

interface Credentials {
  anthropic_oauth_token: string;
  anthropic_api_key: string;
  openai_api_key: string;
}

const fromModels = (m?: Models): Credentials => ({
  anthropic_oauth_token: m?.anthropic?.oauth_token ?? "",
  anthropic_api_key: m?.anthropic?.api_key ?? "",
  openai_api_key: m?.openai?.api_key ?? "",
});

// A token copied from a wrapped terminal line pastes with the break inside it.
const compact = (draft: string) => draft.replace(/\s+/g, "");

/** Which credential the daemon hands the Claude CLI, mirroring the adapter's order of preference. */
function anthropicSource(token: string, apiKey: string): string {
  if (token) return "Signed in with the saved token.";
  if (apiKey) return "Signed in with the saved API key.";
  return "Borrowing the Claude CLI's own sign-in. It expires and can't renew itself while Fonte runs unattended, so add a token.";
}

function BuiltinCredentials({
  settings,
  onSaveField,
}: {
  settings: Settings;
  onSaveField: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const models = settings.models;
  // Secrets live one level down in settings.models and the section save
  // merges one level deep, so a commit sends whole provider objects.
  const s = useAutoSaveSection(fromModels(models), async (patch: Partial<Credentials>) => {
    const anthropic = { ...models?.anthropic };
    const openai = { ...models?.openai };
    if (patch.anthropic_oauth_token !== undefined) anthropic.oauth_token = patch.anthropic_oauth_token || undefined;
    if (patch.anthropic_api_key !== undefined) anthropic.api_key = patch.anthropic_api_key || undefined;
    if (patch.openai_api_key !== undefined) openai.api_key = patch.openai_api_key || undefined;
    await onSaveField({ anthropic, openai });
  });
  const token = useDraft(s.value("anthropic_oauth_token"), (d) => s.commit("anthropic_oauth_token", compact(d)));
  const anthropicKey = useDraft(s.value("anthropic_api_key"), (d) => s.commit("anthropic_api_key", compact(d)));
  const openaiKey = useDraft(s.value("openai_api_key"), (d) => s.commit("openai_api_key", compact(d)));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">Anthropic</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {anthropicSource(s.value("anthropic_oauth_token"), s.value("anthropic_api_key"))}
        </p>
        <div className="divide-y divide-border/50">
          <SettingRow
            label="Token"
            description={
              <>
                Paste the output of <code className="font-mono">claude setup-token</code>. Preferred over the API key
              </>
            }
            status={s.statusFor("anthropic_oauth_token")}
          >
            <SecretInput {...token} placeholder="sk-ant-oat01-…" className="w-56" />
          </SettingRow>
          <SettingRow
            label="API key"
            description="Used when no token is set"
            status={s.statusFor("anthropic_api_key")}
          >
            <SecretInput {...anthropicKey} placeholder="sk-ant-api03-…" className="w-56" />
          </SettingRow>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium">OpenAI</p>
        <div className="divide-y divide-border/50">
          <SettingRow
            label="API key"
            description="For agents on the Codex provider"
            status={s.statusFor("openai_api_key")}
          >
            <SecretInput {...openaiKey} placeholder="sk-…" className="w-56" />
          </SettingRow>
        </div>
      </div>
    </div>
  );
}

export function ProvidersSection({
  settings,
  onSaveField,
}: {
  settings: Settings;
  onSaveField: (patch: Record<string, unknown>) => Promise<void>;
}) {
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
      id="providers"
      className="scroll-mt-6"
      title={
        <span className="inline-flex items-center gap-2">
          <Plug className="size-5 text-muted-foreground" weight="bold" />
          Providers
        </span>
      }
      count={entries.length}
      description="Credentials for the built-in providers. Add custom ones for OpenAI-compatible endpoints"
      action={
        !showAdd ? (
          <Button size="sm" onClick={() => setShowAdd(true)} className="text-xs">
            Add custom
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-2xs uppercase tracking-wider text-muted-foreground mb-1.5">Built-in</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {BUILTIN_PROVIDERS.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-muted text-foreground"
              >
                {p.name}
              </span>
            ))}
          </div>
          <BuiltinCredentials settings={settings} onSaveField={onSaveField} />
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
