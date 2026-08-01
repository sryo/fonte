"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getSettings,
  updateSettings,
  getTorrentConfig,
  updateTorrentConfig,
  type Settings,
  type TorrentConfig,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { LoadingState, Spinner } from "@/components/ui/feedback";
import { restartService } from "@/lib/api";
import { AgentPersonalitySection } from "@/components/settings/AgentPersonalitySection";
import { AgentsSection } from "@/components/settings/AgentsSection";
import { ProvidersSection } from "@/components/settings/ProvidersSection";
import { SubtitleSettingsCard } from "@/components/settings/SubtitleSettingsCard";
import { NotificationSettingsCard } from "@/components/settings/NotificationSettingsCard";
import { TorrentSettingsCard } from "@/components/settings/TorrentSettingsCard";
import { WatchlistSettingsCard } from "@/components/settings/WatchlistSettingsCard";
import { WhatsAppSection } from "@/components/settings/WhatsAppSection";

const SECRET_KEY_RE = /(api_key|oauth_token|token)$/i;
const REDACTED = "__REDACTED__";

/** Replace secret-shaped string leaves so the Advanced editor never renders
    keys in plaintext. */
function redactSecrets(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(redactSecrets);
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] =
      SECRET_KEY_RE.test(key) && typeof value === "string" && value !== ""
        ? REDACTED
        : redactSecrets(value);
  }
  return out;
}

/** Restore untouched redaction sentinels from the live settings at the same
    path, so a round-trip through the editor never persists the placeholder. */
function restoreSecrets(node: unknown, source: unknown): unknown {
  if (Array.isArray(node)) return node.map((v, i) => restoreSecrets(v, Array.isArray(source) ? source[i] : undefined));
  if (typeof node !== "object" || node === null) return node;
  const src = (typeof source === "object" && source !== null ? source : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = value === REDACTED ? src[key] : restoreSecrets(value, src[key]);
  }
  return out;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [torrentConfig, setTorrentConfig] = useState<TorrentConfig | null>(null);
  const [rawJson, setRawJson] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<{ section: string; message: string } | null>(null);
  const rawJsonDirtyRef = useRef(false);
  const [torrentLoadFailed, setTorrentLoadFailed] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const errorFor = (section: string) =>
    sectionError?.section === section ? sectionError.message : undefined;

  function loadAll() {
    return Promise.all([getSettings(), getTorrentConfig().catch(() => null)])
      .then(([s, tc]) => {
        setSettings(s);
        setRawJson(JSON.stringify(redactSecrets(s), null, 2));
        rawJsonDirtyRef.current = false;
        setTorrentConfig(tc ? tc.config : null);
        setTorrentLoadFailed(!tc);
      })
      .catch((err) => setErrorMsg((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    void loadAll();
     
  }, []);

  const saveTorrentSettings = useCallback(async (updates: Partial<TorrentConfig>) => {
    setSavingSection("torrent");
    setSectionError(null);
    try {
      const result = await updateTorrentConfig(updates);
      setTorrentConfig(result.config);
      setSavedSection("torrent");
      setTimeout(() => setSavedSection(null), 2000);
    } catch (err) {
      setSectionError({ section: "torrent", message: (err as Error).message });
    } finally {
      setSavingSection(null);
    }
  }, []);

  const saveGeneralSettings = useCallback(async (updates: Partial<Settings>, section: string) => {
    setSavingSection(section);
    setSectionError(null);
    try {
      const result = await updateSettings(updates);
      setSettings(result.settings);
      if (!rawJsonDirtyRef.current) {
        setRawJson(JSON.stringify(redactSecrets(result.settings), null, 2));
      }
      setSavedSection(section);
      setTimeout(() => setSavedSection(null), 2000);
    } catch (err) {
      setSectionError({ section, message: (err as Error).message });
    } finally {
      setSavingSection(null);
    }
  }, []);

  const saveRawJson = useCallback(async () => {
    setSavingSection("advanced");
    setSectionError(null);
    try {
      const parsed = JSON.parse(rawJson);
      const restored = restoreSecrets(parsed, settings) as Partial<Settings>;
      const result = await updateSettings(restored);
      setSettings(result.settings);
      setRawJson(JSON.stringify(redactSecrets(result.settings), null, 2));
      rawJsonDirtyRef.current = false;
      setSavedSection("advanced");
      setTimeout(() => setSavedSection(null), 2000);
    } catch (err) {
      setSectionError({ section: "advanced", message: (err as Error).message });
    } finally {
      setSavingSection(null);
    }
  }, [rawJson, settings]);

  if (loading) {
    return <LoadingState label="Loading settings…" />;
  }

  if (!settings && errorMsg) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground space-y-3">
          <p>Could not load settings. The API server may not be reachable.</p>
          <p>
            <a href="/control" className="text-primary underline underline-offset-2">
              Go to Control
            </a>
            {" "}to check the connection or change the API address.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setErrorMsg(null);
              setLoading(true);
              void loadAll();
            }}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6 animate-card-enter">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure downloads, integrations, and agents
        </p>
      </div>

      <div className="flex justify-end -mt-12">
        <Button variant="ghost" size="sm" onClick={() => setRestartOpen(true)} disabled={restarting} className="text-xs text-muted-foreground">
          {restarting ? "Restarting…" : "Restart daemon"}
        </Button>
      </div>

      {errorMsg && (
        <div className="flex items-center justify-between px-4 py-3 text-sm rounded-xl border border-destructive/30 bg-destructive/5 text-destructive">
          <span>{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            aria-label="Dismiss error"
            className="text-destructive/60 hover:text-destructive transition-colors ml-3 shrink-0"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {!torrentConfig && torrentLoadFailed && (
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          Could not load torrent settings — the torrent manager may be starting up.{" "}
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void loadAll();
            }}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Retry
          </button>
        </div>
      )}

      {torrentConfig && (
        <TorrentSettingsCard
          config={torrentConfig}
          onSave={saveTorrentSettings}
          saving={savingSection === "torrent"}
          saved={savedSection === "torrent"}
          error={errorFor("torrent")}
        />
      )}

      {settings && (
        <WatchlistSettingsCard
          settings={settings}
          onSave={(updates) => saveGeneralSettings(updates, "watchlist")}
          saving={savingSection === "watchlist"}
          saved={savedSection === "watchlist"}
          error={errorFor("watchlist")}
        />
      )}

      {settings && (
        <SubtitleSettingsCard
          settings={settings}
          onSave={(updates) => saveGeneralSettings(updates, "subtitles")}
          saving={savingSection === "subtitles"}
          saved={savedSection === "subtitles"}
          error={errorFor("subtitles")}
        />
      )}

      {settings && (
        <NotificationSettingsCard
          settings={settings}
          onSave={(updates) => saveGeneralSettings(updates, "notifications")}
          saving={savingSection === "notifications"}
          saved={savedSection === "notifications"}
          error={errorFor("notifications")}
        />
      )}

      <WhatsAppSection />

      <ProvidersSection />

      <AgentsSection />

      <AgentPersonalitySection />

      <div className="rounded-xl bg-card shadow-card overflow-hidden">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-expanded={showAdvanced}
          aria-controls="advanced-json-panel"
          className="w-full flex items-center justify-between p-4 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
            </svg>
            Advanced (Raw JSON)
          </span>
          <svg aria-hidden="true" className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {showAdvanced && (
          <div id="advanced-json-panel" className="px-4 pb-4 space-y-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              Edit the raw configuration JSON. Most changes apply immediately; watchlist
              scheduling applies after a daemon restart. API keys render as {"\u0022__REDACTED__\u0022"} and
              keep their saved values unless you type a new one.
            </p>
            <Textarea
              value={rawJson}
              onChange={(e) => {
                setRawJson(e.target.value);
                rawJsonDirtyRef.current = true;
              }}
              rows={20}
              className="font-mono text-xs leading-relaxed"
              spellCheck={false}
            />
            <div className="flex items-center gap-3">
              <Button onClick={saveRawJson} disabled={savingSection === "advanced"}>
                {savingSection === "advanced" && <Spinner size="xs" />}
                Save JSON
              </Button>
              {errorFor("advanced") && (
                <span className="text-xs text-destructive">{errorFor("advanced")}</span>
              )}
              {savedSection === "advanced" && (
                <span className="text-sm text-done flex items-center gap-1">
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

      <ConfirmDialog
        open={restartOpen}
        title="Restart the daemon?"
        message="Active transfers continue in Transmission; the API and agents are briefly unavailable while Fonte restarts."
        confirmLabel="Restart"
        busyLabel="Restarting…"
        onConfirm={async () => {
          setRestarting(true);
          try {
            await restartService();
          } finally {
            setTimeout(() => {
              setRestarting(false);
              setLoading(true);
              void loadAll();
            }, 4000);
          }
        }}
        onClose={() => setRestartOpen(false)}
      />
    </div>
  );
}
