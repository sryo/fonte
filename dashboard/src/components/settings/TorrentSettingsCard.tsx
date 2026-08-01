"use client";

import { useState } from "react";
import { type TorrentConfig } from "@/lib/api";
import { DownloadSimple } from "@phosphor-icons/react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { SettingRow, SectionSaveButton, NumberInput } from "@/components/settings/shared";

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

  // Adopt refetched values only while pristine (or when they echo this
  // card's own save) so sibling saves can't wipe in-progress edits.
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
        <span className="inline-flex items-center gap-2">
          <DownloadSimple className="h-4 w-4 text-torrent" weight="bold" />
          Torrent
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
          <NumberInput
            value={local.max_concurrent}
            onCommit={(n) => update("max_concurrent", n)}
            className="w-28 text-sm text-right"
            min={1}
          />
        </SettingRow>

        <SettingRow label="Max download speed" description="KB/s, 0 = unlimited">
          <NumberInput
            value={local.max_download_speed}
            onCommit={(n) => update("max_download_speed", n)}
            className="w-28 text-sm text-right"
            min={0}
            placeholder="0"
          />
        </SettingRow>

        <SettingRow label="Max upload speed" description="KB/s, 0 = unlimited">
          <NumberInput
            value={local.max_upload_speed}
            onCommit={(n) => update("max_upload_speed", n)}
            className="w-28 text-sm text-right"
            min={0}
            placeholder="0"
          />
        </SettingRow>

        <SettingRow label="Seed ratio limit" description="Stop seeding once uploaded/downloaded reaches this ratio, 0 = seed forever">
          <NumberInput
            value={local.seed_ratio_limit}
            onCommit={(n) => update("seed_ratio_limit", n)}
            className="w-28 text-sm text-right"
            min={0}
            step={0.1}
          />
        </SettingRow>

        <SettingRow label="DHT" description="Distributed hash table for peer discovery">
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
