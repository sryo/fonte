"use client";

import { useState, useEffect, useRef } from "react";
import {
  startWhatsApp,
  getWhatsAppStatus,
  stopWhatsApp,
  unlinkWhatsApp,
  getWhatsAppChats,
  getAllowedChat,
  setAllowedChat,
  requestWhatsAppPairingCode,
  type WhatsAppChat,
} from "@/lib/api";
import { WhatsappLogo } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Section } from "@/components/ui/section";
import { Spinner } from "@/components/ui/feedback";

export function WhatsAppSection() {
  const [status, setStatus] = useState<string>("disconnected");
  const [qr, setQr] = useState<string | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [showPairing, setShowPairing] = useState(false);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
    setConnectError(null);
    try {
      await startWhatsApp();
    } catch (err) {
      setConnectError((err as Error).message);
    }
    setConnectLoading(false);
  };

  // Routine stop — the paired session survives; unlinking is a separate,
  // confirmed action.
  const handleDisconnect = async () => {
    setConnectLoading(true);
    setConnectError(null);
    try {
      await stopWhatsApp();
      setStatus("disconnected");
      setQr(null);
      setShowPairing(false);
      setPairingCode(null);
    } catch (err) {
      setConnectError((err as Error).message);
    }
    setConnectLoading(false);
  };

  const handleUnlink = async () => {
    await unlinkWhatsApp();
    setStatus("disconnected");
    setQr(null);
    setShowPairing(false);
    setPairingCode(null);
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
    <Section
      title={
        <span className="flex items-center gap-2">
          <WhatsappLogo className="h-4 w-4 text-done" weight="bold" />
          WhatsApp
        </span>
      }
      description="Control Fonte from your phone"
    >
      <div className="space-y-4">
        {status === "disconnected" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect WhatsApp to manage torrents and get notifications on your phone.
            </p>
            {connectError && <p className="text-xs text-destructive">{connectError}</p>}
            <div className="flex gap-2">
              <Button
                onClick={handleConnect}
                disabled={connectLoading}
              >
                {connectLoading ? "Connecting…" : "Connect with QR"}
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
          <div className="text-center py-4 space-y-3">
            <Spinner className="mx-auto text-done" />
            <p className="text-sm text-muted-foreground">Initializing WhatsApp…</p>
            <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={connectLoading}>
              Cancel
            </Button>
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
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDisconnect}
                  disabled={connectLoading}
                  className="text-xs text-muted-foreground"
                >
                  Disconnect
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setUnlinkOpen(true)}
                  disabled={connectLoading}
                  className="text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  Unlink device
                </Button>
              </div>
            </div>
            <WhatsAppChatPicker />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={unlinkOpen}
        title="Unlink this device?"
        message="WhatsApp will revoke the link and wipe the saved session — reconnecting requires scanning a new QR code. To stop temporarily, use Disconnect instead."
        confirmLabel="Unlink"
        destructive
        busyLabel="Unlinking…"
        onConfirm={handleUnlink}
        onClose={() => setUnlinkOpen(false)}
      />
    </Section>
  );
}

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

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleChange = async (value: string) => {
    const next = value === "" ? null : value;
    const prev = selected;
    setSelected(next);
    setSaving(true);
    setSaveError(null);
    try {
      await setAllowedChat(next);
    } catch (err) {
      // Roll back — showing an unpersisted chat as monitored would be a lie
      // about what the daemon listens to.
      setSelected(prev);
      setSaveError((err as Error).message);
    }
    setSaving(false);
  };

  return (
    <div className="space-y-2 pt-3 border-t">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Monitored chat</Label>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        Only messages from this chat will be sent to the agent. Defaults to none — pick a chat to enable.
      </p>
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      {loading ? (
        <div className="h-9 rounded-md border bg-muted/30 animate-pulse" />
      ) : (
        <Select value={selected ?? "__none__"} onValueChange={(v) => handleChange(v === "__none__" ? "" : v)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Ignore everything</SelectItem>
            {chats.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
                {c.isGroup ? " · group" : ""}
                {c.unread > 0 ? ` (${c.unread})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
