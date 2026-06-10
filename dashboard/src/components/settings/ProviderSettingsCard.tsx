"use client";

import { useState } from "react";
import { type Settings } from "@/lib/api";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingRow, SectionSaveButton } from "@/components/settings/shared";

// ── Provider Settings Card ──────────────────────────────────────────────

export function ProviderSettingsCard({
  settings,
  onSave,
  saving,
  saved,
}: {
  settings: Settings;
  onSave: (updates: Partial<Settings>) => void;
  saving: boolean;
  saved: boolean;
}) {
  const [provider, setProvider] = useState(settings.models?.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState(() => {
    const p = settings.models?.provider ?? "anthropic";
    if (p === "anthropic") return settings.models?.anthropic?.api_key ?? "";
    if (p === "openai") return settings.models?.openai?.api_key ?? "";
    return "";
  });

  const handleSave = () => {
    const models: Settings["models"] = {
      ...settings.models,
      provider,
    };
    if (provider === "anthropic") {
      models.anthropic = { ...models.anthropic, api_key: apiKey || undefined };
    } else if (provider === "openai") {
      models.openai = { ...models.openai, api_key: apiKey || undefined };
    }
    onSave({ ...settings, models });
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="p-4 pb-0">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <svg className="h-4 w-4 text-agent" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
          </svg>
          AI Provider
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Language model provider for AI features</p>
      </div>

      <div className="px-4 pb-4 divide-y divide-border/50">
        <SettingRow label="Provider" description="AI model provider">
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow label="API key" description={`${provider === "anthropic" ? "Anthropic" : "OpenAI"} API key`}>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-60 text-sm"
            placeholder="Enter API key"
          />
        </SettingRow>

        <SectionSaveButton
          onClick={handleSave}
          saving={saving}
          saved={saved}
          accentClass="bg-agent text-agent-foreground hover:bg-agent/90"
        />
      </div>
    </div>
  );
}
