"use client";

import { useState } from "react";
import { Check, Copy } from "@phosphor-icons/react";
import { createTorrent } from "@/lib/api";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/feedback";

/**
 * Seed local content: point at a file/folder on the daemon machine, get a
 * .torrent built and handed to Transmission, and walk away with the magnet.
 */
export function CreateTorrentModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [path, setPath] = useState("");
  const [tracker, setTracker] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magnetUri, setMagnetUri] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setPath("");
    setTracker("");
    setError(null);
    setMagnetUri(null);
    setWarning(null);
    setCopied(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!path.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const trackers = tracker.trim() ? [tracker.trim()] : [];
      const res = await createTorrent({ path: path.trim(), trackers });
      setMagnetUri(res.magnetUri);
      setWarning(res.warning ?? null);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copyMagnet = async () => {
    if (!magnetUri) return;
    await navigator.clipboard.writeText(magnetUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal open={open} onClose={close} title={magnetUri ? "Seeding" : "Create Torrent"}>
      {magnetUri ? (
        <div className="space-y-3">
          <p className={warning ? "text-sm text-warning" : "text-sm text-muted-foreground"}>
            {warning ?? "Transmission verified the data and is seeding it. Share this magnet link:"}
          </p>
          <div className="rounded-md bg-muted p-3 font-mono text-2xs break-all">{magnetUri}</div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={copyMagnet}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy magnet"}
            </Button>
            <Button size="sm" variant="ghost" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="create-torrent-path">File or folder on this machine</Label>
            <Input
              id="create-torrent-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="~/Downloads/fonte/…"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-torrent-tracker">
              Tracker URL <span className="font-normal text-muted-foreground">(optional — DHT works without one)</span>
            </Label>
            <Input
              id="create-torrent-tracker"
              value={tracker}
              onChange={(e) => setTracker(e.target.value)}
              placeholder="udp://…"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={submit} disabled={!path.trim() || busy}>
              {busy && <Spinner size="xs" />}
              {busy ? "Creating…" : "Create & Seed"}
            </Button>
            <Button size="sm" variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
