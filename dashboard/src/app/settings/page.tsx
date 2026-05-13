"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getSettings,
  updateSettings,
  getTorrentConfig,
  updateTorrentConfig,
  type Settings,
  type TorrentConfig,
} from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ────────────────────────────────────────────────────────────────

interface WatchlistSettings {
  enabled?: boolean;
  check_interval?: number;
  auto_add?: boolean;
  preferred_quality?: string;
  jackett_url?: string;
  jackett_api_key?: string;
}

interface SubtitleSettings {
  enabled?: boolean;
  auto_download?: boolean;
  translate?: boolean;
  target_languages?: string[];
  tmdb_api_key?: string;
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [torrentConfig, setTorrentConfig] = useState<TorrentConfig | null>(null);
  const [rawJson, setRawJson] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Section save states
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [s, tc] = await Promise.all([
        getSettings(),
        getTorrentConfig().catch(() => null),
      ]);
      setSettings(s);
      setRawJson(JSON.stringify(s, null, 2));
      if (tc) setTorrentConfig(tc.config);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Save torrent config
  const saveTorrentSettings = useCallback(async (updates: Partial<TorrentConfig>) => {
    setSavingSection("torrent");
    setErrorMsg(null);
    try {
      const result = await updateTorrentConfig(updates);
      setTorrentConfig(result.config);
      setSavedSection("torrent");
      setTimeout(() => setSavedSection(null), 2000);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSavingSection(null);
    }
  }, []);

  // Save general settings
  const saveGeneralSettings = useCallback(async (updates: Partial<Settings>) => {
    setSavingSection("general");
    setErrorMsg(null);
    try {
      const result = await updateSettings(updates);
      setSettings(result.settings);
      setRawJson(JSON.stringify(result.settings, null, 2));
      setSavedSection("general");
      setTimeout(() => setSavedSection(null), 2000);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSavingSection(null);
    }
  }, []);

  // Save raw JSON
  const saveRawJson = useCallback(async () => {
    setSavingSection("advanced");
    setErrorMsg(null);
    try {
      const parsed = JSON.parse(rawJson);
      const result = await updateSettings(parsed);
      setSettings(result.settings);
      setRawJson(JSON.stringify(result.settings, null, 2));
      setSavedSection("advanced");
      setTimeout(() => setSavedSection(null), 2000);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSavingSection(null);
    }
  }, [rawJson]);

  if (loading) {
    return (
      <div className="p-6 md:p-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-16 justify-center">
          <div className="h-5 w-5 animate-spin border-2 border-primary border-t-transparent rounded-full" />
          Loading settings...
        </div>
      </div>
    );
  }

  if (!settings && errorMsg) {
    return (
      <div className="p-6 md:p-8">
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground space-y-2">
          <p>Could not load settings. The API server may not be reachable.</p>
          <p>
            <a href="/control" className="text-primary underline underline-offset-2">
              Go to Control Plane
            </a>
            {" "}to check the connection or change the API address.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <svg className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure AITorrent modules and integrations
        </p>
      </div>

      {/* Error banner */}
      {errorMsg && (
        <div className="flex items-center justify-between px-4 py-3 text-sm rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <span>{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-destructive/60 hover:text-destructive transition-colors ml-3 shrink-0"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Torrent Settings */}
      {torrentConfig && (
        <TorrentSettingsCard
          config={torrentConfig}
          onSave={saveTorrentSettings}
          saving={savingSection === "torrent"}
          saved={savedSection === "torrent"}
        />
      )}

      {/* Watchlist Settings */}
      {settings && (
        <WatchlistSettingsCard
          settings={settings}
          onSave={saveGeneralSettings}
          saving={savingSection === "general"}
          saved={savedSection === "general"}
        />
      )}

      {/* Subtitle Settings */}
      {settings && (
        <SubtitleSettingsCard
          settings={settings}
          onSave={saveGeneralSettings}
          saving={savingSection === "general"}
          saved={savedSection === "general"}
        />
      )}

      {/* Provider Settings */}
      {settings && (
        <ProviderSettingsCard
          settings={settings}
          onSave={saveGeneralSettings}
          saving={savingSection === "general"}
          saved={savedSection === "general"}
        />
      )}

      {/* Advanced: Raw JSON */}
      <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between p-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
            </svg>
            Advanced (Raw JSON)
          </span>
          <svg className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {showAdvanced && (
          <div className="px-4 pb-4 space-y-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              Edit the raw configuration JSON. Changes take effect on next processing cycle.
            </p>
            <Textarea
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              rows={20}
              className="font-mono text-xs leading-relaxed"
              spellCheck={false}
            />
            <div className="flex items-center gap-3">
              <button
                onClick={saveRawJson}
                disabled={savingSection === "advanced"}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
              >
                {savingSection === "advanced" && (
                  <div className="h-3 w-3 animate-spin border-2 border-primary-foreground border-t-transparent rounded-full" />
                )}
                Save JSON
              </button>
              {savedSection === "advanced" && (
                <span className="text-sm text-subtitle flex items-center gap-1">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  Saved
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Setting Row ─────────────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── Section Save Button ─────────────────────────────────────────────────

function SectionSaveButton({
  onClick,
  saving,
  saved,
  accentClass = "bg-primary text-primary-foreground hover:bg-primary/90",
}: {
  onClick: () => void;
  saving: boolean;
  saved: boolean;
  accentClass?: string;
}) {
  return (
    <div className="flex items-center gap-3 pt-2 mt-2 border-t border-border/50">
      <button
        onClick={onClick}
        disabled={saving}
        className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${accentClass}`}
      >
        {saving && (
          <div className="h-3 w-3 animate-spin border-2 border-current border-t-transparent rounded-full" />
        )}
        Save
      </button>
      {saved && (
        <span className="text-sm text-subtitle flex items-center gap-1">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          Saved
        </span>
      )}
    </div>
  );
}

// ── Torrent Settings Card ───────────────────────────────────────────────

function TorrentSettingsCard({
  config,
  onSave,
  saving,
  saved,
}: {
  config: TorrentConfig;
  onSave: (updates: Partial<TorrentConfig>) => void;
  saving: boolean;
  saved: boolean;
}) {
  const [local, setLocal] = useState<TorrentConfig>(config);

  useEffect(() => {
    setLocal(config);
  }, [config]);

  const update = <K extends keyof TorrentConfig>(key: K, value: TorrentConfig[K]) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden border-t-[3px] border-t-torrent">
      <div className="p-4 pb-0">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <svg className="h-4 w-4 text-torrent" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Torrent Settings
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Download engine and transfer configuration</p>
      </div>

      <div className="px-4 pb-4 divide-y divide-border/50">
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

        <SettingRow label="Auto start" description="Automatically start new torrents">
          <Switch
            checked={local.auto_start}
            onCheckedChange={(v) => update("auto_start", v)}
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
          accentClass="bg-torrent text-torrent-foreground hover:bg-torrent/90"
        />
      </div>
    </div>
  );
}

// ── Watchlist Settings Card ─────────────────────────────────────────────

function WatchlistSettingsCard({
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

  const handleSave = () => {
    onSave({
      ...settings,
      watchlist: {
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
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden border-t-[3px] border-t-watchlist">
      <div className="p-4 pb-0">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <svg className="h-4 w-4 text-watchlist" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          Watchlist Settings
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">Automatic media tracking and search</p>
      </div>

      <div className="px-4 pb-4 divide-y divide-border/50">
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
    </div>
  );
}

// ── Subtitle Settings Card ──────────────────────────────────────────────

function SubtitleSettingsCard({
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
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden border-t-[3px] border-t-subtitle">
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

// ── Provider Settings Card ──────────────────────────────────────────────

function ProviderSettingsCard({
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
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden border-t-[3px] border-t-agent">
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
