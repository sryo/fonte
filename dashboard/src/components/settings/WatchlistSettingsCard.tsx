"use client";

import { useState, useEffect } from "react";
import { type Settings } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Section } from "@/components/ui/section";
import { SettingRow, SectionSaveButton } from "@/components/settings/shared";

interface WatchlistSettings {
  enabled?: boolean;
  check_interval?: number;
  auto_add?: boolean;
  preferred_quality?: string;
  jackett_url?: string;
  jackett_api_key?: string;
}

// ── Watchlist Settings Card ─────────────────────────────────────────────

export function WatchlistSettingsCard({
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
  const raw = (settings as Record<string, unknown>).watchlist as WatchlistSettings | undefined;
  const [enabled, setEnabled] = useState(raw?.enabled ?? false);
  const [checkInterval, setCheckInterval] = useState(raw?.check_interval ?? 30);
  const [autoAdd, setAutoAdd] = useState(raw?.auto_add ?? true);
  const [preferredQuality, setPreferredQuality] = useState(raw?.preferred_quality ?? "1080p");
  const [jackettUrl, setJackettUrl] = useState(raw?.jackett_url ?? "");
  const [jackettApiKey, setJackettApiKey] = useState(raw?.jackett_api_key ?? "");

  // Resync on refetch so saving this card doesn't write back a stale snapshot.
  useEffect(() => {
    setEnabled(raw?.enabled ?? false);
    setCheckInterval(raw?.check_interval ?? 30);
    setAutoAdd(raw?.auto_add ?? true);
    setPreferredQuality(raw?.preferred_quality ?? "1080p");
    setJackettUrl(raw?.jackett_url ?? "");
    setJackettApiKey(raw?.jackett_api_key ?? "");
  }, [raw]);

  const handleSave = () => {
    // Send only this section; spreading the whole settings object would
    // overwrite keys edited elsewhere with this card's stale copy.
    onSave({
      watchlist: {
        ...raw,
        enabled,
        check_interval: checkInterval,
        auto_add: autoAdd,
        preferred_quality: preferredQuality,
        jackett_url: jackettUrl,
        jackett_api_key: jackettApiKey,
      },
    } as Partial<Settings>);
  };

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4 text-watchlist" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          Watchlist Settings
        </span>
      }
      description="Automatic media tracking and search"
    >
      <div className="divide-y divide-border/50">
        <SettingRow label="Enabled" description="Enable watchlist monitoring">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </SettingRow>

        <SettingRow label="Check interval" description="Minutes between automatic checks">
          <Input
            type="number"
            value={checkInterval}
            onChange={(e) => setCheckInterval(parseInt(e.target.value) || 0)}
            className="w-24 text-sm text-right"
            min={1}
          />
        </SettingRow>

        <SettingRow label="Auto add" description="Automatically add best match to downloads">
          <Switch checked={autoAdd} onCheckedChange={setAutoAdd} />
        </SettingRow>

        <SettingRow label="Preferred quality" description="Default quality for new entries">
          <Select value={preferredQuality} onValueChange={setPreferredQuality}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="720p">720p</SelectItem>
              <SelectItem value="1080p">1080p</SelectItem>
              <SelectItem value="4K">4K</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow label="Jackett URL" description="Jackett indexer API endpoint">
          <Input
            value={jackettUrl}
            onChange={(e) => setJackettUrl(e.target.value)}
            className="w-60 text-sm"
            placeholder="http://localhost:9117"
          />
        </SettingRow>

        <SettingRow label="Jackett API key" description="Authentication key for Jackett">
          <Input
            type="password"
            value={jackettApiKey}
            onChange={(e) => setJackettApiKey(e.target.value)}
            className="w-60 text-sm"
            placeholder="Enter API key"
          />
        </SettingRow>

        <SectionSaveButton
          onClick={handleSave}
          saving={saving}
          saved={saved}
          accentClass="bg-watchlist text-watchlist-foreground hover:bg-watchlist/90"
        />
      </div>
    </Section>
  );
}
