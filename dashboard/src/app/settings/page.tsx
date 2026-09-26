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
import { LoadingState } from "@/components/ui/feedback";
import { restartService } from "@/lib/api";
import { primeCachedSettings } from "@/lib/settings-cache";
import { retryUntil } from "@/lib/retry";
import { mergeSection, rawJsonPatch, redactSecrets, restoreSecrets } from "@/lib/settings-patch";
import { SaveFooter } from "@/components/settings/shared";
import { AgentPersonalitySection } from "@/components/settings/AgentPersonalitySection";
import { AgentsSection } from "@/components/settings/AgentsSection";
import { ProvidersSection } from "@/components/settings/ProvidersSection";
import { SubtitleSettingsCard } from "@/components/settings/SubtitleSettingsCard";
import { NotificationSettingsCard } from "@/components/settings/NotificationSettingsCard";
import { TorrentSettingsCard } from "@/components/settings/TorrentSettingsCard";
import { WatchlistSettingsCard } from "@/components/settings/WatchlistSettingsCard";
import { WhatsAppSection } from "@/components/settings/WhatsAppSection";

const RESTART_GRACE_MS = 1500;
const RESTART_LOAD_ATTEMPTS = 20;

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [torrentConfig, setTorrentConfig] = useState<TorrentConfig | null>(null);
  const [rawJson, setRawJson] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [advSaving, setAdvSaving] = useState(false);
  const [advSaved, setAdvSaved] = useState(false);
  const [advError, setAdvError] = useState<string | null>(null);
  const rawJsonDirtyRef = useRef(false);
  const rawBaselineRef = useRef<Record<string, unknown>>({});
  const settingsRef = useRef<Settings | null>(null);
  const [torrentLoadFailed, setTorrentLoadFailed] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  const adoptSettings = useCallback((s: Settings, resetRawJson: boolean) => {
    settingsRef.current = s;
    setSettings(s);
    primeCachedSettings(s);
    if (resetRawJson || !rawJsonDirtyRef.current) {
      const redacted = redactSecrets(s) as Record<string, unknown>;
      rawBaselineRef.current = redacted;
      setRawJson(JSON.stringify(redacted, null, 2));
      rawJsonDirtyRef.current = false;
    }
  }, []);

  function loadAll(attempts = 1) {
    return retryUntil(() => Promise.all([getSettings(), getTorrentConfig().catch(() => null)]), {
      attempts,
      delayMs: 1000,
    })
      .then(([s, tc]) => {
        adoptSettings(s, true);
        setTorrentConfig(tc ? tc.config : null);
        setTorrentLoadFailed(!tc);
      })
      .catch((err) => setErrorMsg((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    void loadAll();

  }, []);

  // Sections mount after the fetch, too late for the browser's own hash scroll.
  useEffect(() => {
    if (loading) return;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [loading]);

  const saveTorrentField = useCallback(async (patch: Partial<TorrentConfig>) => {
    const result = await updateTorrentConfig(patch);
    setTorrentConfig(result.config);
  }, []);

  // PUT /api/settings merges top-level keys only, so a field commit must
  // carry the whole sub-object, composed from the freshest settings.
  const saveSettingsSection = useCallback(
    async (section: string, patch: Record<string, unknown>) => {
      const cur = (settingsRef.current as Record<string, unknown> | null)?.[section];
      const result = await updateSettings({
        [section]: mergeSection(cur, patch),
      } as Partial<Settings>);
      adoptSettings(result.settings, false);
    },
    [adoptSettings]
  );

  const refreshSettings = useCallback(async () => {
    adoptSettings(await getSettings(), false);
  }, [adoptSettings]);

  const saveRawJson = useCallback(async () => {
    setAdvSaving(true);
    setAdvError(null);
    try {
      const parsed: unknown = JSON.parse(rawJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("The settings must be a JSON object.");
      }
      const { patch, removed } = rawJsonPatch(parsed as Record<string, unknown>, rawBaselineRef.current);
      if (removed.length) {
        throw new Error(`Saving can't remove ${removed.join(", ")}. Put it back and clear its fields instead.`);
      }
      const { value, unresolved } = restoreSecrets(patch, settingsRef.current);
      if (unresolved.length) {
        throw new Error(`Type the value for ${unresolved.join(", ")}. The placeholder only keeps a secret already saved there.`);
      }
      const result = await updateSettings(value as Partial<Settings>);
      adoptSettings(result.settings, true);
      setAdvSaved(true);
      setTimeout(() => setAdvSaved(false), 2000);
    } catch (err) {
      setAdvError((err as Error).message);
    } finally {
      setAdvSaving(false);
    }
  }, [rawJson, adoptSettings]);

  if (loading) {
    return <LoadingState label="Loading settings…" />;
  }

  if (!settings && errorMsg) {
    return (
      <div className="max-w-(--content-max-w) mx-auto px-6 py-6">
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
    <div className="max-w-(--content-max-w) mx-auto px-6 py-6 space-y-6 animate-card-enter">
      <div>
        <h1 className="text-[40px] leading-none font-black tracking-[-0.03em]">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure downloads, integrations, and agents
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 -mt-12">
        {restartError && <span className="text-xs text-destructive">{restartError}</span>}
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
          Could not load torrent settings. The torrent manager may be starting up.{" "}
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
        <TorrentSettingsCard config={torrentConfig} onSaveField={saveTorrentField} />
      )}

      {settings && (
        <WatchlistSettingsCard
          settings={settings}
          onSaveField={(patch) => saveSettingsSection("watchlist", patch)}
        />
      )}

      {settings && (
        <SubtitleSettingsCard
          settings={settings}
          onSaveField={(patch) => saveSettingsSection("subtitles", patch)}
        />
      )}

      {settings && (
        <NotificationSettingsCard
          settings={settings}
          onSaveField={(patch) => saveSettingsSection("notifications", patch)}
        />
      )}

      <WhatsAppSection />

      {settings && (
        <ProvidersSection
          settings={settings}
          onSaveField={(patch) => saveSettingsSection("models", patch)}
          onChanged={refreshSettings}
        />
      )}

      {settings && <AgentsSection settings={settings} onChanged={refreshSettings} />}

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
            <SaveFooter
              label="Save JSON"
              onClick={saveRawJson}
              saving={advSaving}
              saved={advSaved}
              error={advError}
            />
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
          setRestartError(null);
          try {
            await restartService();
          } catch (err) {
            setRestartError((err as Error).message || "Restart failed");
            return;
          }
          setRestarting(true);
          setTimeout(() => {
            setLoading(true);
            void loadAll(RESTART_LOAD_ATTEMPTS).finally(() => setRestarting(false));
          }, RESTART_GRACE_MS);
        }}
        onClose={() => setRestartOpen(false)}
      />
    </div>
  );
}
