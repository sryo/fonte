"use client";

import { useState, useEffect, useCallback } from "react";
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
import {
  chatOptions,
  disconnectMessage,
  keepPairingCode,
  parseWhatsAppStatus,
  startingLabel,
  whatsAppPanel,
  type WhatsAppStatusInfo,
} from "@/lib/whatsapp-flow";

export function WhatsAppSection() {
  const [info, setInfo] = useState<WhatsAppStatusInfo>({ status: "disconnected", linked: false });
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const applyStatus = useCallback((next: WhatsAppStatusInfo) => {
    setInfo(next);
    setPairingCode((code) => keepPairingCode(code, next.status));
    if (next.status === "connected") setPairing(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyStatus(parseWhatsAppStatus(await getWhatsAppStatus()));
    } catch {}
  }, [applyStatus]);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const data = await getWhatsAppStatus();
        if (mounted) applyStatus(parseWhatsAppStatus(data));
      } catch {}
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => { mounted = false; clearInterval(id); };
  }, [applyStatus]);

  const drawQr = useCallback((canvas: HTMLCanvasElement | null) => {
    const qr = info.qr;
    if (!canvas || !qr) return;
    import("qrcode").then((QRCode) => {
      QRCode.toCanvas(canvas, qr, {
        width: 240,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
    });
  }, [info.qr]);

  const resetPairing = () => {
    setPairing(false);
    setPairingCode(null);
    setPairingError(null);
  };

  const handleConnect = async () => {
    setBusy(true);
    setConnectError(null);
    try {
      applyStatus(parseWhatsAppStatus(await startWhatsApp()));
    } catch (err) {
      setConnectError((err as Error).message);
    }
    setBusy(false);
  };

  const handleStop = async () => {
    setBusy(true);
    setConnectError(null);
    try {
      await stopWhatsApp();
      resetPairing();
      await refresh();
    } catch (err) {
      setConnectError((err as Error).message);
    }
    setBusy(false);
  };

  const handleUnlink = async () => {
    setConnectError(null);
    try {
      await unlinkWhatsApp();
    } catch (err) {
      setConnectError((err as Error).message);
      throw err;
    }
    resetPairing();
    await refresh();
  };

  const handleRequestPairing = async () => {
    setPairingError(null);
    if (!phone.trim()) return;
    setPairingLoading(true);
    try {
      const res = await requestWhatsAppPairingCode(phone.trim());
      setPairingCode(res.code);
      await refresh();
    } catch (err) {
      setPairingError((err as Error).message);
    }
    setPairingLoading(false);
  };

  const handleCancelPairing = async () => {
    if (pairingCode) await handleStop();
    else resetPairing();
  };

  const panel = whatsAppPanel({ status: info.status, linked: info.linked, pairing });
  const reasonMessage = disconnectMessage(info.reason);

  return (
    <Section
      title={
        <span className="inline-flex items-center gap-2">
          <WhatsappLogo className="size-5 text-muted-foreground" weight="bold" />
          WhatsApp
        </span>
      }
      description="Control Fonte from your phone"
    >
      <div className="space-y-4">
        {panel === "link" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect WhatsApp to manage torrents and get notifications on your phone.
            </p>
            {reasonMessage && <p className="text-xs text-destructive">{reasonMessage}</p>}
            {connectError && <p className="text-xs text-destructive">{connectError}</p>}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => { setPairing(true); setPairingCode(null); setPairingError(null); }}
                disabled={busy}
              >
                Pair with phone number
              </Button>
              <Button onClick={handleConnect} disabled={busy}>
                {busy ? "Connecting…" : "Connect with QR"}
              </Button>
            </div>
          </div>
        )}

        {panel === "paused" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paused. Your phone stays linked, so reconnecting needs no QR code.
            </p>
            {reasonMessage && <p className="text-xs text-destructive">{reasonMessage}</p>}
            {connectError && <p className="text-xs text-destructive">{connectError}</p>}
            <Button onClick={handleConnect} disabled={busy}>
              {busy ? "Reconnecting…" : "Reconnect"}
            </Button>
          </div>
        )}

        {panel === "starting" && (
          <div className="text-center py-4 space-y-3">
            <Spinner className="mx-auto text-done" />
            <p className="text-sm text-muted-foreground">{startingLabel(info.linked)}</p>
            {connectError && <p className="text-xs text-destructive">{connectError}</p>}
            <Button variant="ghost" size="sm" onClick={handleStop} disabled={busy}>
              Cancel
            </Button>
          </div>
        )}

        {panel === "qr" && (
          <div className="text-center space-y-3">
            <div className="inline-block rounded-xl border bg-white p-3">
              <canvas ref={drawQr} />
            </div>
            <div>
              <p className="text-sm font-medium">Scan this QR code</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Open WhatsApp &rarr; Settings &rarr; Linked Devices &rarr; Link a Device
              </p>
            </div>
            {connectError && <p className="text-xs text-destructive">{connectError}</p>}
            <div className="flex justify-center gap-2">
              <Button variant="ghost" onClick={handleStop} disabled={busy} className="text-muted-foreground">
                Cancel
              </Button>
              <Button variant="outline" onClick={() => setPairing(true)} disabled={busy}>
                Use phone number instead
              </Button>
            </div>
          </div>
        )}

        {panel === "pairing" && (
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
                  onKeyDown={(e) => { if (e.key === "Enter") handleRequestPairing(); }}
                  className="font-mono"
                />
                {info.reason === "qr_expired" && !pairingError && (
                  <p className="text-xs text-destructive">{reasonMessage}</p>
                )}
                {pairingError && (
                  <p className="text-xs text-destructive">{pairingError}</p>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    onClick={handleCancelPairing}
                    disabled={busy}
                    className="text-muted-foreground"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleRequestPairing}
                    disabled={pairingLoading || busy || !phone.trim()}
                  >
                    {pairingLoading ? "Requesting…" : "Get pairing code"}
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
                {pairingError && (
                  <p className="text-xs text-destructive">{pairingError}</p>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    onClick={handleCancelPairing}
                    disabled={busy}
                    className="text-muted-foreground"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleRequestPairing}
                    disabled={pairingLoading || busy}
                  >
                    {pairingLoading ? "Requesting…" : "New code"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {panel === "connected" && (
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
                  onClick={handleStop}
                  disabled={busy}
                  className="text-xs text-muted-foreground"
                >
                  Disconnect
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setUnlinkOpen(true)}
                  disabled={busy}
                  className="text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  Unlink device
                </Button>
              </div>
            </div>
            {connectError && <p className="text-xs text-destructive">{connectError}</p>}
            <WhatsAppChatPicker />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={unlinkOpen}
        title="Unlink this device?"
        message="WhatsApp will revoke the link and wipe the saved session. Reconnecting requires scanning a new QR code. To stop temporarily, use Disconnect instead."
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
        Only messages from this chat are sent to the agent. Pick a chat to enable.
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
            {chatOptions(chats, selected).map((c) => (
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
