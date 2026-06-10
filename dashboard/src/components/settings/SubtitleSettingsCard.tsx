"use client";

import { useState } from "react";
import { type Settings } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { SettingRow, SectionSaveButton } from "@/components/settings/shared";

interface SubtitleSettings {
  enabled?: boolean;
  auto_download?: boolean;
  translate?: boolean;
  target_languages?: string[];
  tmdb_api_key?: string;
}

// ── Subtitle Settings Card ──────────────────────────────────────────────

export function SubtitleSettingsCard({
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
  const raw = (settings as Record<string, unknown>).subtitles as SubtitleSettings | undefined;
  const [enabled, setEnabled] = useState(raw?.enabled ?? false);
  const [autoDownload, setAutoDownload] = useState(raw?.auto_download ?? false);
  const [translate, setTranslate] = useState(raw?.translate ?? false);
  const [targetLanguages, setTargetLanguages] = useState((raw?.target_languages ?? []).join(", "));
  const [tmdbApiKey, setTmdbApiKey] = useState(raw?.tmdb_api_key ?? "");

  const handleSave = () => {
    const languages = targetLanguages
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean);
    onSave({
      ...settings,
      subtitles: {
        enabled,
        auto_download: autoDownload,
        translate,
        target_languages: languages,
        tmdb_api_key: tmdbApiKey,
      },
    } as Partial<Settings>);
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="p-4 pb-0">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <svg className="h-4 w-4 text-subtitle" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
          </svg>
          Subtitle Settings
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Automatic subtitle fetching and translation</p>
      </div>

      <div className="px-4 pb-4 divide-y divide-border/50">
        <SettingRow label="Enabled" description="Enable subtitle management">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </SettingRow>

        <SettingRow label="Auto download" description="Fetch subtitles when torrents complete">
          <Switch checked={autoDownload} onCheckedChange={setAutoDownload} />
        </SettingRow>

        <SettingRow label="Translate" description="Auto-translate subtitles to target languages">
          <Switch checked={translate} onCheckedChange={setTranslate} />
        </SettingRow>

        <SettingRow label="Target languages" description="Comma-separated language codes (e.g. es, fr, de)">
          <Input
            value={targetLanguages}
            onChange={(e) => setTargetLanguages(e.target.value)}
            className="w-48 text-sm"
            placeholder="es, fr, de"
          />
        </SettingRow>

        <SettingRow label="TMDB API key" description="The Movie Database API key for metadata">
          <Input
            type="password"
            value={tmdbApiKey}
            onChange={(e) => setTmdbApiKey(e.target.value)}
            className="w-60 text-sm"
            placeholder="Enter API key"
          />
        </SettingRow>

        <SectionSaveButton
          onClick={handleSave}
          saving={saving}
          saved={saved}
          accentClass="bg-subtitle text-subtitle-foreground hover:bg-subtitle/90"
        />
      </div>
    </div>
  );
}
