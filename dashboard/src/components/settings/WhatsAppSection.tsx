"use client";

import { useState, useEffect, useRef } from "react";
import {
  startWhatsApp,
  getWhatsAppStatus,
  stopWhatsApp,
  getWhatsAppChats,
  getAllowedChat,
  setAllowedChat,
  requestWhatsAppPairingCode,
  type WhatsAppChat,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ── WhatsApp Section ────────────────────────────────────────────────────

export function WhatsAppSection() {
  const [status, setStatus] = useState<string>("disconnected");
  const [qr, setQr] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);
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
    setConnectLoading(true);
    try {
      await startWhatsApp();
    } catch {}
    setConnectLoading(false);
  };

  const handleDisconnect = async () => {
    setConnectLoading(true);
    try {
      await stopWhatsApp();
      setStatus("disconnected");
      setQr(null);
      setShowPairing(false);
      setPairingCode(null);
    } catch {}
    setConnectLoading(false);
  };

  const handleRequestPairing = async () => {
    setPairingError(null);
    if (!phone.trim()) return;
    setPairingLoading(true);
    try {
      const res = await requestWhatsAppPairingCode(phone.trim());
      setPairingCode(res.code);
    } catch (err) {
      setPairingError((err as Error).message);
    }
    setPairingLoading(false);
  };

  return (
    <div className="rounded-xl bg-card shadow-card">
      <div className="p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold">WhatsApp</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control Fonte from your phone
          </p>
        </div>

        {status === "disconnected" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect WhatsApp to manage torrents and get notifications on your phone.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleConnect}
                disabled={connectLoading}
                className="bg-done text-white hover:bg-done/90"
              >
                {connectLoading ? "Connecting..." : "Connect with QR"}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setShowPairing(true); setPairingCode(null); }}
                disabled={connectLoading}
              >
                Pair with phone number
              </Button>
            </div>
          </div>
        )}

        {status === "connecting" && (
          <div className="text-center py-4">
            <div className="h-5 w-5 border-2 border-done border-t-transparent rounded-full animate-spin mx-auto" />
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
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            {!pairingCode ? (
              <>
                <p className="text-sm font-medium">Pair with phone number</p>
                <p className="text-xs text-muted-foreground">
                  Enter your phone number (country code + number, digits only).
                </p>
                <Input
                  type="tel"
                  inputMode="numeric"
                  placeholder="14155551234"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="font-mono"
                />
                {pairingError && (
                  <p className="text-xs text-destructive">{pairingError}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleRequestPairing}
                    disabled={pairingLoading || !phone.trim()}
                    className="text-xs"
                  >
                    {pairingLoading ? "Requesting..." : "Get pairing code"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setShowPairing(false); setPhone(""); setPairingError(null); }}
                    className="text-xs text-muted-foreground"
                  >
                    Cancel
                  </Button>
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
                <span className="h-2.5 w-2.5 rounded-full bg-done animate-pulse" />
                <span className="text-sm font-medium">Connected</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                disabled={connectLoading}
                className="text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                Disconnect
              </Button>
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
        <div className="h-9 rounded-md border bg-muted/30 animate-pulse" />
      ) : (
        <select
          value={selected ?? ""}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full h-9 px-3 text-sm rounded-md border bg-background"
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
