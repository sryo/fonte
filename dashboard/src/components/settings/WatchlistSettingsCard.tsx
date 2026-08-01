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
import { SettingRow, SectionSaveButton, SecretInput, NumberInput } from "@/components/settings/shared";

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

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function WatchlistSettingsCard({
  settings,
  onSave,
  saving,
  saved,
  error,
}: {
  settings: Settings;
  onSave: (updates: Partial<Settings>) => void;
  saving: boolean;
  saved: boolean;
  error?: string | null;
}) {
  const raw = (settings as Record<string, unknown>).watchlist as WatchlistSettings | undefined;
  const seeded = fromRaw(raw);
  const [enabled, setEnabled] = useState(seeded.enabled);
  const [checkInterval, setCheckInterval] = useState(seeded.check_interval_minutes);
  const [autoAdd, setAutoAdd] = useState(seeded.auto_add);
  const [preferredQuality, setPreferredQuality] = useState(seeded.preferred_quality);
  const [jackettUrl, setJackettUrl] = useState(seeded.jackett_url);
  const [jackettApiKey, setJackettApiKey] = useState(seeded.jackett_api_key);

  const current = {
    enabled,
    check_interval_minutes: checkInterval,
    auto_add: autoAdd,
    preferred_quality: preferredQuality,
    jackett_url: jackettUrl,
    jackett_api_key: jackettApiKey,
  };

  // Resync on refetch — but only when this card is pristine (or the refetch
  // echoes its own save), so a sibling's save can't wipe in-progress edits.
  const [prevRaw, setPrevRaw] = useState(raw);
  if (prevRaw !== raw) {
    setPrevRaw(raw);
    if (eq(current, fromRaw(prevRaw)) || eq(current, seeded)) {
      setEnabled(seeded.enabled);
      setCheckInterval(seeded.check_interval_minutes);
      setAutoAdd(seeded.auto_add);
      setPreferredQuality(seeded.preferred_quality);
      setJackettUrl(seeded.jackett_url);
      setJackettApiKey(seeded.jackett_api_key);
    }
  }

  const dirty = !eq(current, seeded);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await getIndexerStatus();
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

  const handleSave = () => {
    // Send only this section; spreading the whole settings object would
    // overwrite keys edited elsewhere with this card's stale copy.
    onSave({
      watchlist: {
        ...raw,
        enabled,
        check_interval_minutes: checkInterval,
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
          <Eye className="h-4 w-4 text-watchlist" weight="bold" />
          Watchlist
        </span>
      }
      description="Automatic media tracking and search"
    >
      <div className="divide-y divide-border/50">
        <SettingRow label="Enabled" description="Enable watchlist monitoring · applies after daemon restart">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </SettingRow>

        <SettingRow label="Check interval" description="Minutes between automatic checks · applies after daemon restart">
          <NumberInput
            value={checkInterval}
            onCommit={setCheckInterval}
            className="w-28 text-sm text-right"
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

        <SettingRow
          label="Jackett API key"
          description={
            <>
              Shown in the top bar of the{" "}
              <a
                href={jackettUrl || "http://localhost:9117"}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Jackett dashboard ↗
              </a>
            </>
          }
        >
          <SecretInput
            value={jackettApiKey}
            onChange={(e) => setJackettApiKey(e.target.value)}
            className="w-60"
            placeholder="Enter API key"
          />
        </SettingRow>

        <SettingRow label="Test connection" description="Checks Jackett with the saved URL and key">
          <div className="flex items-center gap-2">
            {testResult && <span className="text-xs text-muted-foreground">{testResult}</span>}
            <Button type="button" variant="outline" size="sm" onClick={handleTest} disabled={testing}>
              {testing ? "Testing…" : "Test"}
            </Button>
          </div>
        </SettingRow>

        <SectionSaveButton
          onClick={handleSave}
          saving={saving}
          saved={saved}
          disabled={!dirty}
          error={error}
          accentClass="bg-watchlist text-watchlist-foreground hover:bg-watchlist/90"
        />
      </div>
    </Section>
  );
}
