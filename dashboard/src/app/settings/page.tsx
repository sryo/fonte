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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AgentPersonalitySection } from "@/components/settings/AgentPersonalitySection";
import { AgentsSection } from "@/components/settings/AgentsSection";
import { ProvidersSection } from "@/components/settings/ProvidersSection";
import { SubtitleSettingsCard } from "@/components/settings/SubtitleSettingsCard";
import { TorrentSettingsCard } from "@/components/settings/TorrentSettingsCard";
import { WatchlistSettingsCard } from "@/components/settings/WatchlistSettingsCard";
import { WhatsAppSection } from "@/components/settings/WhatsAppSection";

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
  const saveGeneralSettings = useCallback(async (updates: Partial<Settings>, section: string) => {
    setSavingSection(section);
    setErrorMsg(null);
    try {
      const result = await updateSettings(updates);
      setSettings(result.settings);
      setRawJson(JSON.stringify(result.settings, null, 2));
      setSavedSection(section);
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
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6 animate-card-enter">
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
          Configure Fonte modules and integrations
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

      {/* Agent Personality */}
      <AgentPersonalitySection />

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
          onSave={(updates) => saveGeneralSettings(updates, "watchlist")}
          saving={savingSection === "watchlist"}
          saved={savedSection === "watchlist"}
        />
      )}

      {/* Subtitle Settings */}
      {settings && (
        <SubtitleSettingsCard
          settings={settings}
          onSave={(updates) => saveGeneralSettings(updates, "subtitles")}
          saving={savingSection === "subtitles"}
          saved={savedSection === "subtitles"}
        />
      )}

      {/* WhatsApp Channel */}
      <WhatsAppSection />

      {/* Agents — with inline custom-provider creation */}
      <AgentsSection />

      {/* Providers — built-in + custom (management) */}
      <ProvidersSection />

      {/* Advanced: Raw JSON */}
      <div className="rounded-xl bg-card shadow-card overflow-hidden">
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
              <Button onClick={saveRawJson} disabled={savingSection === "advanced"}>
                {savingSection === "advanced" && (
                  <div className="h-3 w-3 animate-spin border-2 border-primary-foreground border-t-transparent rounded-full" />
                )}
                Save JSON
              </Button>
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
