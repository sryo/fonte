"use client";

import { useState } from "react";
import { type TorrentConfig } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { SettingRow, SectionSaveButton } from "@/components/settings/shared";

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function TorrentSettingsCard({
  config,
  onSave,
  saving,
  saved,
  error,
}: {
  config: TorrentConfig;
  onSave: (updates: Partial<TorrentConfig>) => void;
  saving: boolean;
  saved: boolean;
  error?: string | null;
}) {
  const [local, setLocal] = useState<TorrentConfig>(config);

  // Resync on refetch — but only when this card is pristine (or the refetch
  // echoes its own save), so a sibling's save can't wipe in-progress edits.
  const [prevConfig, setPrevConfig] = useState(config);
  if (prevConfig !== config) {
    setPrevConfig(config);
    if (eq(local, prevConfig) || eq(local, config)) {
      setLocal(config);
    }
  }

  const dirty = !eq(local, config);

  const update = <K extends keyof TorrentConfig>(key: K, value: TorrentConfig[K]) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4 text-torrent" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Torrent Settings
        </span>
      }
      description="Download engine and transfer configuration"
    >
      <div className="divide-y divide-border/50">
        <SettingRow label="Download directory" description="Where completed torrents are saved">
          <Input
            value={local.download_dir}
            onChange={(e) => update("download_dir", e.target.value)}
            className="w-60 text-sm"
            placeholder="/downloads"
          />
        </SettingRow>

        <SettingRow label="Max concurrent downloads" description="Simultaneous active transfers">
          <Input
            type="number"
            value={local.max_concurrent}
            onChange={(e) => update("max_concurrent", parseInt(e.target.value) || 0)}
            className="w-24 text-sm text-right"
            min={1}
          />
        </SettingRow>

        <SettingRow label="Max download speed" description="KB/s (0 = unlimited)">
          <Input
            type="number"
            value={local.max_download_speed}
            onChange={(e) => update("max_download_speed", parseInt(e.target.value) || 0)}
            className="w-28 text-sm text-right"
            min={0}
            placeholder="0"
          />
        </SettingRow>

        <SettingRow label="Max upload speed" description="KB/s (0 = unlimited)">
          <Input
            type="number"
            value={local.max_upload_speed}
            onChange={(e) => update("max_upload_speed", parseInt(e.target.value) || 0)}
            className="w-28 text-sm text-right"
            min={0}
            placeholder="0"
          />
        </SettingRow>

        <SettingRow label="Seed ratio limit" description="Stop seeding after reaching this ratio">
          <Input
            type="number"
            value={local.seed_ratio_limit}
            onChange={(e) => update("seed_ratio_limit", parseFloat(e.target.value) || 0)}
            className="w-24 text-sm text-right"
            min={0}
            step={0.1}
          />
        </SettingRow>

        <SettingRow label="DHT enabled" description="Distributed hash table for peer discovery">
          <Switch
            checked={local.dht}
            onCheckedChange={(v) => update("dht", v)}
          />
        </SettingRow>

        <SectionSaveButton
          onClick={() => onSave(local)}
          saving={saving}
          saved={saved}
          disabled={!dirty}
          error={error}
          accentClass="bg-torrent text-torrent-foreground hover:bg-torrent/90"
        />
      </div>
    </Section>
  );
}
