"use client";

import { useState } from "react";
import { type Settings } from "@/lib/api";
import { Eye } from "@phosphor-icons/react";
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
import { Button } from "@/components/ui/button";
import { getIndexerStatus } from "@/lib/api";
import {
  SettingRow,
  SecretInput,
  NumberInput,
  useAutoSaveSection,
  useDraft,
} from "@/components/settings/shared";

interface WatchlistSettings {
  enabled?: boolean;
  check_interval_minutes?: number;
  auto_add?: boolean;
  preferred_quality?: string;
  jackett_url?: string;
  jackett_api_key?: string;
}

const fromRaw = (r?: WatchlistSettings) => ({
  enabled: r?.enabled ?? false,
  check_interval_minutes: r?.check_interval_minutes ?? 30,
  auto_add: r?.auto_add ?? true,
  preferred_quality: r?.preferred_quality ?? "1080p",
  jackett_url: r?.jackett_url ?? "",
  jackett_api_key: r?.jackett_api_key ?? "",
});

export function WatchlistSettingsCard({
  settings,
  onSaveField,
}: {
  settings: Settings;
  onSaveField: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const raw = (settings as Record<string, unknown>).watchlist as WatchlistSettings | undefined;
  const s = useAutoSaveSection(fromRaw(raw), onSaveField);
  const jackettUrl = useDraft(s.value("jackett_url"), (d) => s.commit("jackett_url", d));
  const jackettApiKey = useDraft(s.value("jackett_api_key"), (d) => s.commit("jackett_api_key", d));

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await getIndexerStatus(true);
      setTestResult(
        res.ok
          ? `Connected — ${res.count} indexer${res.count === 1 ? "" : "s"}`
          : res.reason || "Jackett unreachable"
      );
    } catch (err) {
      setTestResult((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <Eye className="size-5 text-muted-foreground" weight="bold" />
          Watchlist
        </span>
      }
      description="Automatic media tracking and search"
    >
      <div className="divide-y divide-border/50">
        <SettingRow
          label="Enabled"
          description="Enable watchlist monitoring. Applies after daemon restart"
          status={s.statusFor("enabled")}
        >
          <Switch checked={s.value("enabled")} onCheckedChange={(v) => s.commit("enabled", v)} />
        </SettingRow>

        <SettingRow
          label="Check interval"
          description="Minutes between automatic checks. Applies after daemon restart"
          status={s.statusFor("check_interval_minutes")}
        >
          <NumberInput
            value={s.value("check_interval_minutes")}
            onCommit={(n) => s.commit("check_interval_minutes", n)}
            className="w-28 text-sm text-right"
            min={1}
          />
        </SettingRow>

        <SettingRow
          label="Auto add"
          description="Automatically add best match to downloads"
          status={s.statusFor("auto_add")}
        >
          <Switch checked={s.value("auto_add")} onCheckedChange={(v) => s.commit("auto_add", v)} />
        </SettingRow>

        <SettingRow
          label="Preferred quality"
          description="Default quality for new entries"
          status={s.statusFor("preferred_quality")}
        >
          <Select
            value={s.value("preferred_quality")}
            onValueChange={(v) => s.commit("preferred_quality", v)}
          >
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

        <SettingRow
          label="Jackett URL"
          description="Jackett indexer API endpoint"
          status={s.statusFor("jackett_url")}
        >
          <Input {...jackettUrl} className="w-60 text-sm" placeholder="http://localhost:9117" />
        </SettingRow>

        <SettingRow
          label="Jackett API key"
          status={s.statusFor("jackett_api_key")}
          description={
            <>
              Shown in the top bar of the{" "}
              <a
                href={s.value("jackett_url") || "http://localhost:9117"}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Jackett dashboard ↗
              </a>
            </>
          }
        >
          <SecretInput {...jackettApiKey} className="w-60" placeholder="Enter API key" />
        </SettingRow>

        <SettingRow label="Test connection" description="Checks Jackett with the saved URL and key">
          <div className="flex items-center gap-2">
            {testResult && <span className="text-xs text-muted-foreground">{testResult}</span>}
            <Button type="button" variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? "Testing…" : "Test"}
            </Button>
          </div>
        </SettingRow>
      </div>
    </Section>
  );
}
