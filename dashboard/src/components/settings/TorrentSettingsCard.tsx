"use client";

import { type TorrentConfig } from "@/lib/api";
import { DownloadSimple } from "@phosphor-icons/react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { SettingRow, NumberInput, useAutoSaveSection, useDraft } from "@/components/settings/shared";

export function TorrentSettingsCard({
  config,
  onSaveField,
}: {
  config: TorrentConfig;
  onSaveField: (patch: Partial<TorrentConfig>) => Promise<void>;
}) {
  const s = useAutoSaveSection(config, onSaveField);
  const downloadDir = useDraft(s.value("download_dir"), (d) => s.commit("download_dir", d));

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
        <SettingRow
          label="Download directory"
          description="Where completed torrents are saved"
          status={s.statusFor("download_dir")}
        >
          <Input {...downloadDir} className="w-60 text-sm" placeholder="/downloads" />
        </SettingRow>

        <SettingRow
          label="Max concurrent downloads"
          description="Simultaneous active transfers"
          status={s.statusFor("max_concurrent")}
        >
          <NumberInput
            value={s.value("max_concurrent")}
            onCommit={(n) => s.commit("max_concurrent", n)}
            className="w-28 text-sm text-right"
            min={1}
          />
        </SettingRow>

        <SettingRow
          label="Max download speed"
          description="KB/s, 0 = unlimited"
          status={s.statusFor("max_download_speed")}
        >
          <NumberInput
            value={s.value("max_download_speed")}
            onCommit={(n) => s.commit("max_download_speed", n)}
            className="w-28 text-sm text-right"
            min={0}
            placeholder="0"
          />
        </SettingRow>

        <SettingRow
          label="Max upload speed"
          description="KB/s, 0 = unlimited"
          status={s.statusFor("max_upload_speed")}
        >
          <NumberInput
            value={s.value("max_upload_speed")}
            onCommit={(n) => s.commit("max_upload_speed", n)}
            className="w-28 text-sm text-right"
            min={0}
            placeholder="0"
          />
        </SettingRow>

        <SettingRow
          label="Seed ratio limit"
          description="Stop seeding once uploaded/downloaded reaches this ratio, 0 = seed forever"
          status={s.statusFor("seed_ratio_limit")}
        >
          <NumberInput
            value={s.value("seed_ratio_limit")}
            onCommit={(n) => s.commit("seed_ratio_limit", n)}
            className="w-28 text-sm text-right"
            min={0}
            step={0.1}
          />
        </SettingRow>

        <SettingRow
          label="DHT"
          description="Distributed hash table for peer discovery"
          status={s.statusFor("dht")}
        >
          <Switch checked={s.value("dht")} onCheckedChange={(v) => s.commit("dht", v)} />
        </SettingRow>
      </div>
    </Section>
  );
}
