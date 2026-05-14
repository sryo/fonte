"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getSettings,
  updateSettings,
  getTorrentConfig,
  updateTorrentConfig,
  getSoul,
  saveSoul,
  startWhatsApp,
  getWhatsAppStatus,
  stopWhatsApp,
  getWhatsAppChats,
  getAllowedChat,
  setAllowedChat,
  requestWhatsAppPairingCode,
  type WhatsAppChat,
  getAgents,
  saveAgent,
  deleteAgent,
  sendMessage,
  getCustomProviders,
  saveCustomProvider,
  deleteCustomProvider,
  type Settings,
  type TorrentConfig,
  type AgentConfig,
  type CustomProvider,
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

      {/* WhatsApp Channel */}
      <WhatsAppSection />

      {/* Agents — with inline custom-provider creation */}
      <AgentsSection />

      {/* Providers — built-in + custom (management) */}
      <ProvidersSection />

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

      <p className="text-center text-xs text-muted-foreground pt-4">
        AITorrent v0.0.20
      </p>
    </div>
  );
}

// ── WhatsApp Section ────────────────────────────────────────────────────

function WhatsAppSection() {
  const [status, setStatus] = useState<string>("disconnected");
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPairing, setShowPairing] = useState(false);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Poll status every 2s
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const data = await getWhatsAppStatus();
        if (!mounted) return;
        setStatus(data.status);
        if (data.qr) setQr(data.qr);
        else setQr(null);
      } catch {
        if (mounted) setStatus("disconnected");
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Render QR to canvas
  useEffect(() => {
    if (qr && canvasRef.current) {
      import("qrcode").then((QRCode) => {
        QRCode.toCanvas(canvasRef.current, qr, {
          width: 240,
          margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
        });
      });
    }
  }, [qr]);

  const handleConnect = async () => {
    setLoading(true);
    try {
      await startWhatsApp();
    } catch {}
    setLoading(false);
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await stopWhatsApp();
      setStatus("disconnected");
      setQr(null);
      setShowPairing(false);
      setPairingCode(null);
    } catch {}
    setLoading(false);
  };

  const handleRequestPairing = async () => {
    setPairingError(null);
    if (!phone.trim()) return;
    setLoading(true);
    try {
      const res = await requestWhatsAppPairingCode(phone.trim());
      setPairingCode(res.code);
    } catch (err) {
      setPairingError((err as Error).message);
    }
    setLoading(false);
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">WhatsApp</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control AITorrent from your phone
          </p>
        </div>

        {status === "disconnected" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect WhatsApp to manage torrents and get notifications on your phone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleConnect}
                disabled={loading}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {loading ? "Connecting..." : "Connect with QR"}
              </button>
              <button
                onClick={() => { setShowPairing(true); setPairingCode(null); }}
                disabled={loading}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-accent disabled:opacity-50 transition-colors"
              >
                Pair with phone number
              </button>
            </div>
          </div>
        )}

        {status === "connecting" && (
          <div className="text-center py-4">
            <div className="h-5 w-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground mt-2">Initializing WhatsApp...</p>
          </div>
        )}

        {status === "waiting_qr" && !showPairing && (
          <div className="text-center space-y-3">
            <div className="inline-block rounded-xl border bg-white p-3">
              <canvas ref={canvasRef} />
            </div>
            <div>
              <p className="text-sm font-medium">Scan this QR code</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Open WhatsApp &rarr; Settings &rarr; Linked Devices &rarr; Link a Device
              </p>
            </div>
          </div>
        )}

        {showPairing && status !== "connected" && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            {!pairingCode ? (
              <>
                <p className="text-sm font-medium">Pair with phone number</p>
                <p className="text-xs text-muted-foreground">
                  Enter your phone number (country code + number, digits only).
                </p>
                <input
                  type="tel"
                  inputMode="numeric"
                  placeholder="14155551234"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border bg-background font-mono"
                />
                {pairingError && (
                  <p className="text-xs text-destructive">{pairingError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleRequestPairing}
                    disabled={loading || !phone.trim()}
                    className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
                  >
                    {loading ? "Requesting..." : "Get pairing code"}
                  </button>
                  <button
                    onClick={() => { setShowPairing(false); setPhone(""); setPairingError(null); }}
                    className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Your pairing code</p>
                <p className="text-3xl font-mono font-bold tracking-widest text-center py-2 select-all">
                  {pairingCode.replace(/(.{4})/, "$1 ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  On your phone: <strong>WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number instead</strong>. Code expires in ~60s.
                </p>
              </>
            )}
          </div>
        )}

        {status === "connected" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm font-medium">Connected</span>
              </div>
              <button
                onClick={handleDisconnect}
                disabled={loading}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
              >
                Disconnect
              </button>
            </div>
            <WhatsAppChatPicker />
          </div>
        )}
      </div>
    </div>
  );
}

// ── WhatsApp Chat Picker ────────────────────────────────────────────────

function WhatsAppChatPicker() {
  const [chats, setChats] = useState<WhatsAppChat[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [chatsRes, allowedRes] = await Promise.all([
          getWhatsAppChats(),
          getAllowedChat(),
        ]);
        if (!mounted) return;
        setChats(chatsRes.chats || []);
        setSelected(allowedRes.allowed_chat ?? null);
      } catch {}
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const handleChange = async (value: string) => {
    const next = value === "" ? null : value;
    setSelected(next);
    setSaving(true);
    try { await setAllowedChat(next); } catch {}
    setSaving(false);
  };

  return (
    <div className="space-y-2 pt-3 border-t">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Monitored chat</label>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        Only messages from this chat will be sent to the agent. Defaults to none — pick a chat to enable.
      </p>
      {loading ? (
        <div className="h-9 rounded-lg border bg-muted/30 animate-pulse" />
      ) : (
        <select
          value={selected ?? ""}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full h-9 px-3 text-sm rounded-lg border bg-background"
        >
          <option value="">— Ignore everything —</option>
          {chats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.isGroup ? "👥 " : ""}{c.name}{c.unread > 0 ? ` (${c.unread})` : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ── Agents Section ─────────────────────────────────────────────────────

function AgentsSection() {
  const [agents, setAgents] = useState<Record<string, AgentConfig>>({});
  const [providers, setProviders] = useState<Record<string, CustomProvider>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ id: "", name: "", provider: "anthropic", model: "sonnet" });
  const [saving, setSaving] = useState(false);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [providerForm, setProviderForm] = useState({
    id: "", name: "", harness: "claude" as "claude" | "codex",
    base_url: "", api_key: "", model: "",
  });
  const [savingProvider, setSavingProvider] = useState(false);

  const fetchAll = async () => {
    try {
      const [a, p] = await Promise.all([getAgents(), getCustomProviders()]);
      setAgents(a);
      setProviders(p);
    } catch {}
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSaveProvider = async () => {
    if (!providerForm.id || !providerForm.name || !providerForm.base_url || !providerForm.api_key) return;
    setSavingProvider(true);
    try {
      await saveCustomProvider(providerForm.id, {
        name: providerForm.name,
        harness: providerForm.harness,
        base_url: providerForm.base_url,
        api_key: providerForm.api_key,
        model: providerForm.model || undefined,
      });
      const newId = providerForm.id;
      setProviderForm({ id: "", name: "", harness: "claude", base_url: "", api_key: "", model: "" });
      setShowAddProvider(false);
      await fetchAll();
      // Auto-select the freshly added provider for the agent being created
      setForm((f) => ({ ...f, provider: `custom:${newId}` }));
    } catch {}
    setSavingProvider(false);
  };

  const handleSave = async () => {
    if (!form.id || !form.name || !form.model) return;
    setSaving(true);
    try {
      await saveAgent(form.id, {
        name: form.name,
        provider: form.provider,
        model: form.model,
        working_directory: "",
      });
      setForm({ id: "", name: "", provider: "anthropic", model: "sonnet" });
      setShowAdd(false);
      await fetchAll();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete agent "${id}"? This cannot be undone.`)) return;
    try {
      await deleteAgent(id);
      await fetchAll();
    } catch {}
  };

  const handleReset = async (id: string) => {
    try {
      await sendMessage({ message: `@${id} /reset`, agent: id, channel: "web", sender: "Web" });
    } catch {}
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Agents</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage AI agents and their configurations
            </p>
          </div>
          {!showAdd && (
            <button
              onClick={() => setShowAdd(true)}
              className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Add Agent
            </button>
          )}
        </div>

        {/* Agent list */}
        {Object.keys(agents).length > 0 && (
          <div className="divide-y divide-border/50">
            {Object.entries(agents).map(([id, agent]) => (
              <div key={id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">{id}</code>
                  <span className="text-sm truncate">{agent.name}</span>
                  <span className="text-[10px] font-medium uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
                    {agent.provider}
                  </span>
                  <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
                    {agent.model}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleReset(id)}
                    className="px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => handleDelete(id)}
                    className="px-2.5 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {Object.keys(agents).length === 0 && !showAdd && (
          <p className="text-sm text-muted-foreground">No agents configured yet.</p>
        )}

        {/* Add agent form */}
        {showAdd && (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">ID</Label>
                <Input
                  value={form.id}
                  onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                  placeholder="my-agent"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="My Agent"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Provider</Label>
                <Select
                  value={form.provider}
                  onValueChange={(v) => {
                    if (v === "__add_custom__") {
                      setShowAddProvider(true);
                      return;
                    }
                    setForm((f) => ({ ...f, provider: v }));
                  }}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="anthropic">Anthropic</SelectItem>
                    <SelectItem value="openai">OpenAI</SelectItem>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="opencode">OpenCode</SelectItem>
                    {Object.entries(providers).map(([id, p]) => (
                      <SelectItem key={id} value={`custom:${id}`}>
                        {p.name} (custom)
                      </SelectItem>
                    ))}
                    <SelectItem value="__add_custom__">+ Add custom provider…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Model</Label>
                <Input
                  value={form.model}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  placeholder="sonnet"
                  className="text-sm"
                />
              </div>
            </div>

            {/* Inline custom-provider creation */}
            {showAddProvider && (
              <div className="border rounded-lg p-3 space-y-2 bg-background">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">New custom provider</p>
                  <button
                    onClick={() => setShowAddProvider(false)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={providerForm.id}
                    onChange={(e) => setProviderForm((f) => ({ ...f, id: e.target.value }))}
                    placeholder="ID (e.g. groq)"
                    className="text-xs"
                  />
                  <Input
                    value={providerForm.name}
                    onChange={(e) => setProviderForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Display name"
                    className="text-xs"
                  />
                  <Select
                    value={providerForm.harness}
                    onValueChange={(v) => setProviderForm((f) => ({ ...f, harness: v as "claude" | "codex" }))}
                  >
                    <SelectTrigger className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude">Claude harness</SelectItem>
                      <SelectItem value="codex">Codex harness</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    value={providerForm.model}
                    onChange={(e) => setProviderForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder="Default model (optional)"
                    className="text-xs"
                  />
                </div>
                <Input
                  value={providerForm.base_url}
                  onChange={(e) => setProviderForm((f) => ({ ...f, base_url: e.target.value }))}
                  placeholder="Base URL (https://...)"
                  className="text-xs"
                />
                <Input
                  type="password"
                  value={providerForm.api_key}
                  onChange={(e) => setProviderForm((f) => ({ ...f, api_key: e.target.value }))}
                  placeholder="API key"
                  className="text-xs"
                />
                <button
                  onClick={handleSaveProvider}
                  disabled={savingProvider || !providerForm.id || !providerForm.name || !providerForm.base_url || !providerForm.api_key}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {savingProvider && (
                    <div className="h-3 w-3 animate-spin border-2 border-primary-foreground border-t-transparent rounded-full" />
                  )}
                  Save provider
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving || !form.id || !form.name || !form.model}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving && (
                  <div className="h-3 w-3 animate-spin border-2 border-primary-foreground border-t-transparent rounded-full" />
                )}
                Save
              </button>
              <button
                onClick={() => { setShowAdd(false); setShowAddProvider(false); setForm({ id: "", name: "", provider: "anthropic", model: "sonnet" }); }}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
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

// ── Agent Personality Section ───────────────────────────────────────────

function AgentPersonalitySection() {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSoul()
      .then((data) => {
        setContent(data.content);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await saveSoul(content);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return null;

  return (
    <div className="rounded-xl border shadow-sm bg-card">
      <div className="p-4 pb-0">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <svg className="h-4 w-4 text-agent" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
          </svg>
          Agent Personality
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Define your agent&apos;s communication style. Saved to ~/.aitorrent/SOUL.md
        </p>
      </div>

      <div className="px-4 pb-4 pt-3 space-y-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full min-h-32 p-3 text-sm font-mono rounded-lg border bg-background resize-y"
          placeholder={"# Soul\n\nYou are..."}
        />
        <div className="flex items-center gap-3 pt-2 border-t border-border/50">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-agent text-agent-foreground rounded-lg hover:bg-agent/90 transition-colors disabled:opacity-50"
          >
            {saving && (
              <div className="h-3 w-3 animate-spin border-2 border-current border-t-transparent rounded-full" />
            )}
            {saved ? "Saved" : saving ? "Saving..." : "Save Personality"}
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
      </div>
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
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
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
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
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
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
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
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
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

// ── Providers Section (built-in + custom) ──────────────────────────────

const BUILTIN_PROVIDERS = [
  { id: "anthropic", name: "Anthropic" },
  { id: "openai", name: "OpenAI" },
  { id: "gemini", name: "Gemini" },
  { id: "opencode", name: "OpenCode" },
] as const;

function ProvidersSection() {
  const [providers, setProviders] = useState<Record<string, CustomProvider>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    id: "",
    name: "",
    harness: "claude" as "claude" | "codex",
    base_url: "",
    api_key: "",
    model: "",
  });

  const fetchProviders = async () => {
    try {
      const data = await getCustomProviders();
      setProviders(data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const handleSave = async () => {
    if (!form.id || !form.name || !form.base_url || !form.api_key) return;
    setSaving(true);
    try {
      await saveCustomProvider(form.id, {
        name: form.name,
        harness: form.harness,
        base_url: form.base_url,
        api_key: form.api_key,
        model: form.model || undefined,
      });
      setForm({ id: "", name: "", harness: "claude", base_url: "", api_key: "", model: "" });
      setShowAdd(false);
      await fetchProviders();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete custom provider "${id}"? This cannot be undone.`)) return;
    try {
      await deleteCustomProvider(id);
      await fetchProviders();
    } catch {}
  };

  if (loading) return null;

  const entries = Object.entries(providers);

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Providers</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Built-in providers are always available. Add custom ones for OpenAI-compatible endpoints.
            </p>
          </div>
          {!showAdd && (
            <button
              onClick={() => setShowAdd(true)}
              className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Add Custom
            </button>
          )}
        </div>

        {/* Built-in chips */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Built-in</p>
          <div className="flex flex-wrap gap-1.5">
            {BUILTIN_PROVIDERS.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-muted text-foreground"
              >
                {p.name}
              </span>
            ))}
          </div>
        </div>

        {entries.length > 0 && (
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Custom</p>
        )}

        {/* Provider list */}
        {entries.length > 0 && (
          <div className="divide-y divide-border/50">
            {entries.map(([id, p]) => (
              <div key={id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded shrink-0">{p.name}</code>
                  <span className="text-[10px] font-medium uppercase tracking-wider bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
                    {p.harness}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {p.base_url.replace(/https?:\/\//, "").slice(0, 40)}
                  </span>
                  {p.model && (
                    <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded shrink-0">
                      {p.model}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(id)}
                  className="px-2.5 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors shrink-0"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        {entries.length === 0 && !showAdd && (
          <p className="text-sm text-muted-foreground">No custom providers configured yet.</p>
        )}

        {/* Add provider form */}
        {showAdd && (
          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Provider ID</Label>
                <Input
                  value={form.id}
                  onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                  placeholder="my-provider"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Display Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="My Provider"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Harness</Label>
                <Select
                  value={form.harness}
                  onValueChange={(v) => setForm((f) => ({ ...f, harness: v as "claude" | "codex" }))}
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Model (optional)</Label>
                <Input
                  value={form.model}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  placeholder="model-name"
                  className="text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Base URL</Label>
              <Input
                value={form.base_url}
                onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))}
                placeholder="https://api.example.com"
                className="text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">API Key</Label>
              <Input
                type="password"
                value={form.api_key}
                onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                placeholder="Enter API key"
                className="text-sm"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving || !form.id || !form.name || !form.base_url || !form.api_key}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving && (
                  <div className="h-3 w-3 animate-spin border-2 border-primary-foreground border-t-transparent rounded-full" />
                )}
                Save
              </button>
              <button
                onClick={() => {
                  setShowAdd(false);
                  setForm({ id: "", name: "", harness: "claude", base_url: "", api_key: "", model: "" });
                }}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
